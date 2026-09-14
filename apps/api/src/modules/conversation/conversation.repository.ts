import { db } from "@/db/client.ts"
import { embed } from "@/modules/embed/embed.schema.ts"
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm"

import {
	conversation,
	conversationAttempt,
	conversationDailyCounter,
	conversationMessage,
	conversationSession,
} from "./conversation.schema.ts"

const ACTIVE_STATUSES = ["accepted", "running"] as const
const LEASE_MS = 15_000
const DATE_PREFIX_LENGTH = 10

export type SessionContext = {
	agentId: string
	conversationId: string
	embedAccessVersion: number
	embedId: string
	sessionId: string
}

export type AcceptedAttempt = {
	assistantMessage: typeof conversationMessage.$inferSelect
	attempt: typeof conversationAttempt.$inferSelect
	conversationId: string
	duplicate: boolean
	sessionId: string
	userMessage: typeof conversationMessage.$inferSelect
}

export class AllowanceExceededRepositoryError extends Error {}
export class ConcurrencyExceededRepositoryError extends Error {}
export class SessionBusyRepositoryError extends Error {}
export class SessionUnauthorizedRepositoryError extends Error {}
export class RequestConflictRepositoryError extends Error {}
export class StaleHistoryRepositoryError extends Error {}

export type HistorySnapshot = {
	latestCompletedMessageId: string | null
	messages: (typeof conversationMessage.$inferSelect)[]
	revision: number
}

export type PendingUsageFinalization = {
	agentId: string
	assistantText: string
	attemptId: string
	conversationId: string
	inputText: string
	inputTokens: number | null
	model: string
	outcome: NonNullable<typeof conversationAttempt.$inferSelect.finalOutcome>
	outputTokens: number | null
	provider: string
}

async function acquireAcceptanceLocks(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	identityKey: string,
	networkKey: string,
): Promise<void> {
	for (const key of [`1:${identityKey}`, `2:${networkKey}`]) {
		// oxlint-disable-next-line no-await-in-loop -- fixed identity-before-network order prevents deadlocks.
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
	}
}

export async function findSessionByCredentialHash(credentialHash: string): Promise<SessionContext | undefined> {
	const [row] = await db
		.select({
			sessionId: conversationSession.id,
			conversationId: conversationSession.conversationId,
			embedId: conversationSession.embedId,
			embedAccessVersion: conversationSession.embedAccessVersion,
			agentId: conversation.agentId,
		})
		.from(conversationSession)
		.innerJoin(conversation, eq(conversation.id, conversationSession.conversationId))
		.innerJoin(
			embed,
			and(eq(embed.id, conversationSession.embedId), eq(embed.accessVersion, conversationSession.embedAccessVersion)),
		)
		.where(eq(conversationSession.credentialHash, credentialHash))
		.limit(1)
	if (!row || !row.embedId) return undefined
	return { ...row, embedId: row.embedId }
}

export async function listMessages(conversationId: string): Promise<(typeof conversationMessage.$inferSelect)[]> {
	return db
		.select()
		.from(conversationMessage)
		.where(eq(conversationMessage.conversationId, conversationId))
		.orderBy(asc(conversationMessage.createdAt), asc(conversationMessage.id))
}

export async function getHistorySnapshot(conversationId: string): Promise<HistorySnapshot> {
	return db.transaction(async (tx) => {
		const [state] = await tx
			.select({ revision: conversation.revision, latestCompletedMessageId: conversation.latestCompletedMessageId })
			.from(conversation)
			.where(eq(conversation.id, conversationId))
			.limit(1)
		if (!state) throw new Error("Conversation not found")
		const messages = await tx
			.select()
			.from(conversationMessage)
			.where(eq(conversationMessage.conversationId, conversationId))
			.orderBy(asc(conversationMessage.createdAt), asc(conversationMessage.id))
		return { ...state, messages }
	})
}

async function interruptExpiredAttempts(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	condition: ReturnType<typeof or>,
	now: Date,
): Promise<void> {
	const expired = await tx
		.update(conversationAttempt)
		.set({
			status: "interrupted",
			finalOutcome: sql`CASE WHEN ${conversationAttempt.providerInvoked} THEN 'interrupted'::conversation_final_outcome ELSE NULL END`,
			updatedAt: now,
		})
		.where(
			and(inArray(conversationAttempt.status, ACTIVE_STATUSES), lt(conversationAttempt.leaseExpiresAt, now), condition),
		)
		.returning({ id: conversationAttempt.id })
	if (expired.length === 0) return
	await tx
		.update(conversationMessage)
		.set({ outcome: "interrupted", updatedAt: now })
		.where(
			and(
				inArray(
					conversationMessage.attemptId,
					expired.map((attempt) => attempt.id),
				),
				eq(conversationMessage.role, "assistant"),
			),
		)
}

export async function acceptAttempt(input: {
	agentId: string
	dailyLimit: number
	credentialHash: string
	embedAccessVersion: number
	embedId: string
	inputText: string
	messageText: string
	networkHash: string
	requestId: string
	historyRevision: number
	historyTailId: string | null
	concurrencyLimit: number
}): Promise<AcceptedAttempt> {
	return db.transaction(async (tx) => {
		await acquireAcceptanceLocks(tx, `session:${input.credentialHash}`, `network:${input.agentId}:${input.networkHash}`)

		const [validEmbed] = await tx
			.select({ id: embed.id })
			.from(embed)
			.where(
				and(
					eq(embed.id, input.embedId),
					eq(embed.accessVersion, input.embedAccessVersion),
					eq(embed.agentId, input.agentId),
				),
			)
			.for("update")
			.limit(1)
		if (!validEmbed) throw new SessionUnauthorizedRepositoryError()

		const [existingSession] = await tx
			.select()
			.from(conversationSession)
			.where(eq(conversationSession.credentialHash, input.credentialHash))
			.limit(1)
		let sessionId = existingSession?.id
		let conversationId = existingSession?.conversationId
		if (existingSession) {
			if (
				existingSession.embedId !== input.embedId ||
				existingSession.embedAccessVersion !== input.embedAccessVersion
			) {
				throw new SessionUnauthorizedRepositoryError()
			}
		} else {
			conversationId = crypto.randomUUID()
			sessionId = crypto.randomUUID()
			await tx.insert(conversation).values({ id: conversationId, agentId: input.agentId, embedId: input.embedId })
			await tx.insert(conversationSession).values({
				id: sessionId,
				conversationId,
				embedId: input.embedId,
				embedAccessVersion: input.embedAccessVersion,
				credentialHash: input.credentialHash,
			})
		}
		if (!sessionId || !conversationId) throw new Error("Session context is required")
		const now = new Date()
		await interruptExpiredAttempts(
			tx,
			or(
				eq(conversationAttempt.sessionId, sessionId),
				and(
					eq(conversationAttempt.networkHash, input.networkHash),
					sql`EXISTS (SELECT 1 FROM ${conversation} c WHERE c.id = ${conversationAttempt.conversationId} AND c.agent_id = ${input.agentId})`,
				),
			),
			now,
		)

		const [duplicate] = await tx
			.select()
			.from(conversationAttempt)
			.where(and(eq(conversationAttempt.sessionId, sessionId), eq(conversationAttempt.requestId, input.requestId)))
			.limit(1)
		if (duplicate) {
			const messages = await tx
				.select()
				.from(conversationMessage)
				.where(eq(conversationMessage.attemptId, duplicate.id))
			const userMessage = messages.find((message) => message.role === "user")
			const assistantMessage = messages.find((message) => message.role === "assistant")
			if (!userMessage || !assistantMessage) throw new Error("Attempt messages missing")
			if (userMessage.text !== input.messageText) throw new RequestConflictRepositoryError()
			return { attempt: duplicate, userMessage, assistantMessage, sessionId, conversationId, duplicate: true }
		}
		const [historyState] = await tx
			.select({ revision: conversation.revision, latestCompletedMessageId: conversation.latestCompletedMessageId })
			.from(conversation)
			.where(eq(conversation.id, conversationId))
			.limit(1)
		if (
			!historyState ||
			historyState.revision !== input.historyRevision ||
			historyState.latestCompletedMessageId !== input.historyTailId
		) {
			throw new StaleHistoryRepositoryError()
		}

		const [sessionActive] = await tx
			.select({ value: count() })
			.from(conversationAttempt)
			.where(
				and(
					eq(conversationAttempt.sessionId, sessionId),
					inArray(conversationAttempt.status, ACTIVE_STATUSES),
					gt(conversationAttempt.leaseExpiresAt, now),
				),
			)
		if ((sessionActive?.value ?? 0) > 0) throw new SessionBusyRepositoryError()
		const [networkActive] = await tx
			.select({ value: count() })
			.from(conversationAttempt)
			.innerJoin(conversation, eq(conversation.id, conversationAttempt.conversationId))
			.where(
				and(
					eq(conversation.agentId, input.agentId),
					eq(conversationAttempt.networkHash, input.networkHash),
					inArray(conversationAttempt.status, ACTIVE_STATUSES),
					gt(conversationAttempt.leaseExpiresAt, now),
				),
			)
		if ((networkActive?.value ?? 0) >= input.concurrencyLimit) throw new ConcurrencyExceededRepositoryError()

		const day = now.toISOString().slice(0, DATE_PREFIX_LENGTH)
		const [counter] = await tx
			.insert(conversationDailyCounter)
			.values({ agentId: input.agentId, networkHash: input.networkHash, day, count: 1 })
			.onConflictDoUpdate({
				target: [conversationDailyCounter.agentId, conversationDailyCounter.networkHash, conversationDailyCounter.day],
				set: { count: sql`${conversationDailyCounter.count} + 1`, updatedAt: now },
				setWhere: lt(conversationDailyCounter.count, input.dailyLimit),
			})
			.returning()
		if (!counter) throw new AllowanceExceededRepositoryError()

		const attemptId = crypto.randomUUID()
		const leaseToken = crypto.randomUUID()
		const leaseExpiresAt = new Date(now.getTime() + LEASE_MS)
		const [attempt] = await tx
			.insert(conversationAttempt)
			.values({
				id: attemptId,
				conversationId,
				sessionId,
				requestId: input.requestId,
				inputText: input.inputText,
				networkHash: input.networkHash,
				leaseToken,
				leaseExpiresAt,
			})
			.returning()
		if (!attempt) throw new Error("Attempt insert failed")
		const createdAt = now
		const [userMessage, assistantMessage] = await tx
			.insert(conversationMessage)
			.values([
				{
					id: crypto.randomUUID(),
					conversationId,
					attemptId,
					role: "user",
					text: input.messageText,
					outcome: "completed",
					createdAt,
				},
				{
					id: crypto.randomUUID(),
					conversationId,
					attemptId,
					role: "assistant",
					text: "",
					outcome: "streaming",
					createdAt: new Date(createdAt.getTime() + 1),
				},
			])
			.returning()
		if (!userMessage || !assistantMessage) throw new Error("Message insert failed")
		return { attempt, userMessage, assistantMessage, sessionId, conversationId, duplicate: false }
	})
}

export async function markRunning(attemptId: string, leaseToken: string): Promise<boolean> {
	const rows = await db
		.update(conversationAttempt)
		.set({ status: "running", updatedAt: new Date() })
		.where(
			and(
				eq(conversationAttempt.id, attemptId),
				eq(conversationAttempt.leaseToken, leaseToken),
				eq(conversationAttempt.status, "accepted"),
				gt(conversationAttempt.leaseExpiresAt, new Date()),
			),
		)
		.returning({ id: conversationAttempt.id })
	return rows.length === 1
}

export async function appendOutput(attemptId: string, leaseToken: string, text: string): Promise<boolean> {
	const rows = await db
		.update(conversationMessage)
		.set({ text: sql`${conversationMessage.text} || ${text}`, updatedAt: new Date() })
		.where(
			and(
				eq(conversationMessage.attemptId, attemptId),
				eq(conversationMessage.role, "assistant"),
				sql`EXISTS (SELECT 1 FROM ${conversationAttempt} a WHERE a.id = ${attemptId} AND a.lease_token = ${leaseToken} AND a.status = 'running' AND a.lease_expires_at > now())`,
			),
		)
		.returning({ id: conversationMessage.id })
	return rows.length === 1
}

export async function setAttribution(
	attemptId: string,
	leaseToken: string,
	provider: string,
	model: string,
): Promise<boolean> {
	const rows = await db
		.update(conversationAttempt)
		.set({ provider, model, updatedAt: new Date() })
		.where(
			and(
				eq(conversationAttempt.id, attemptId),
				eq(conversationAttempt.leaseToken, leaseToken),
				eq(conversationAttempt.status, "running"),
				gt(conversationAttempt.leaseExpiresAt, new Date()),
			),
		)
		.returning({ id: conversationAttempt.id })
	return rows.length === 1
}

export async function markProviderInvoked(
	attemptId: string,
	leaseToken: string,
	provider: string,
	model: string,
): Promise<boolean> {
	const rows = await db
		.update(conversationAttempt)
		.set({ provider, model, providerInvoked: true, updatedAt: new Date() })
		.where(
			and(
				eq(conversationAttempt.id, attemptId),
				eq(conversationAttempt.leaseToken, leaseToken),
				eq(conversationAttempt.status, "running"),
				gt(conversationAttempt.leaseExpiresAt, new Date()),
			),
		)
		.returning({ id: conversationAttempt.id })
	return rows.length === 1
}

export async function heartbeat(attemptId: string, leaseToken: string): Promise<boolean> {
	const rows = await db
		.update(conversationAttempt)
		.set({ leaseExpiresAt: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
		.where(
			and(
				eq(conversationAttempt.id, attemptId),
				eq(conversationAttempt.leaseToken, leaseToken),
				eq(conversationAttempt.status, "running"),
				gt(conversationAttempt.leaseExpiresAt, new Date()),
			),
		)
		.returning({ id: conversationAttempt.id })
	return rows.length === 1
}

export async function isCancellationRequested(attemptId: string, leaseToken: string): Promise<boolean> {
	const [row] = await db
		.select({ cancelled: conversationAttempt.cancellationRequestedAt })
		.from(conversationAttempt)
		.where(
			and(
				eq(conversationAttempt.id, attemptId),
				eq(conversationAttempt.leaseToken, leaseToken),
				gt(conversationAttempt.leaseExpiresAt, new Date()),
			),
		)
	return row?.cancelled !== null && row?.cancelled !== undefined
}

export async function stageFinalization(input: {
	attemptId: string
	inputTokens: number
	leaseToken: string
	model: string
	outcome: "blocked" | "cancelled" | "completed" | "failed" | "interrupted"
	outputTokens: number
	provider: string
}): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [attemptContext] = await tx
			.select({ sessionId: conversationAttempt.sessionId })
			.from(conversationAttempt)
			.where(eq(conversationAttempt.id, input.attemptId))
			.limit(1)
		if (!attemptContext) return false
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`1:session:${attemptContext.sessionId}`}, 0))`)
		const rows = await tx
			.update(conversationAttempt)
			.set({
				status: input.outcome,
				finalOutcome: input.outcome,
				provider: input.provider,
				model: input.model,
				usageInputTokens: input.inputTokens,
				usageOutputTokens: input.outputTokens,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(conversationAttempt.id, input.attemptId),
					eq(conversationAttempt.leaseToken, input.leaseToken),
					eq(conversationAttempt.status, "running"),
					eq(conversationAttempt.providerInvoked, true),
					gt(conversationAttempt.leaseExpiresAt, new Date()),
				),
			)
			.returning({ conversationId: conversationAttempt.conversationId })
		const finalized = rows[0]
		if (!finalized) return false
		const [assistant] = await tx
			.update(conversationMessage)
			.set({ outcome: input.outcome, updatedAt: new Date() })
			.where(and(eq(conversationMessage.attemptId, input.attemptId), eq(conversationMessage.role, "assistant")))
			.returning({ id: conversationMessage.id })
		if (!assistant) throw new Error("Assistant message missing during finalization")
		if (input.outcome === "completed") {
			await tx
				.update(conversation)
				.set({
					revision: sql`${conversation.revision} + 1`,
					latestCompletedMessageId: assistant.id,
				})
				.where(eq(conversation.id, finalized.conversationId))
		}
		return true
	})
}

export async function listPendingUsageFinalizations(): Promise<PendingUsageFinalization[]> {
	return db
		.select({
			attemptId: conversationAttempt.id,
			conversationId: conversationAttempt.conversationId,
			agentId: conversation.agentId,
			inputText: conversationAttempt.inputText,
			assistantText: conversationMessage.text,
			provider: sql<string>`coalesce(${conversationAttempt.provider}, 'unknown')`,
			model: sql<string>`coalesce(${conversationAttempt.model}, 'unknown')`,
			outcome: conversationAttempt.finalOutcome,
			inputTokens: conversationAttempt.usageInputTokens,
			outputTokens: conversationAttempt.usageOutputTokens,
		})
		.from(conversationAttempt)
		.innerJoin(conversation, eq(conversation.id, conversationAttempt.conversationId))
		.innerJoin(
			conversationMessage,
			and(eq(conversationMessage.attemptId, conversationAttempt.id), eq(conversationMessage.role, "assistant")),
		)
		.where(
			and(
				eq(conversationAttempt.providerInvoked, true),
				isNotNull(conversationAttempt.finalOutcome),
				isNull(conversationAttempt.usageRecordedAt),
			),
		) as Promise<PendingUsageFinalization[]>
}

export async function stageRecoveredUsageCandidate(
	attemptId: string,
	outcome: PendingUsageFinalization["outcome"],
	inputTokens: number,
	outputTokens: number,
): Promise<boolean> {
	const rows = await db
		.update(conversationAttempt)
		.set({ usageInputTokens: inputTokens, usageOutputTokens: outputTokens, updatedAt: new Date() })
		.where(
			and(
				eq(conversationAttempt.id, attemptId),
				eq(conversationAttempt.finalOutcome, outcome),
				eq(conversationAttempt.providerInvoked, true),
				isNull(conversationAttempt.usageInputTokens),
				isNull(conversationAttempt.usageOutputTokens),
				isNull(conversationAttempt.usageRecordedAt),
			),
		)
		.returning({ id: conversationAttempt.id })
	return rows.length === 1
}

export async function markUsageRecorded(input: {
	attemptId: string
	inputTokens: number
	outcome: PendingUsageFinalization["outcome"]
	outputTokens: number
}): Promise<boolean> {
	const rows = await db
		.update(conversationAttempt)
		.set({ usageRecordedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(conversationAttempt.id, input.attemptId),
				eq(conversationAttempt.finalOutcome, input.outcome),
				eq(conversationAttempt.usageInputTokens, input.inputTokens),
				eq(conversationAttempt.usageOutputTokens, input.outputTokens),
				isNull(conversationAttempt.usageRecordedAt),
			),
		)
		.returning({ id: conversationAttempt.id })
	return rows.length === 1
}

export async function requestCancellation(sessionId: string, attemptId?: string): Promise<boolean> {
	const conditions = [
		eq(conversationAttempt.sessionId, sessionId),
		inArray(conversationAttempt.status, ACTIVE_STATUSES),
		gt(conversationAttempt.leaseExpiresAt, new Date()),
	]
	if (attemptId) conditions.push(eq(conversationAttempt.id, attemptId))
	const rows = await db
		.update(conversationAttempt)
		.set({ cancellationRequestedAt: new Date(), updatedAt: new Date() })
		.where(and(...conditions))
		.returning({ id: conversationAttempt.id })
	return rows.length > 0
}

export async function getActiveAttempt(sessionId: string): Promise<{ id: string } | undefined> {
	const [row] = await db
		.select({ id: conversationAttempt.id })
		.from(conversationAttempt)
		.where(
			and(
				eq(conversationAttempt.sessionId, sessionId),
				inArray(conversationAttempt.status, ACTIVE_STATUSES),
				gt(conversationAttempt.leaseExpiresAt, new Date()),
			),
		)
		.limit(1)
	return row
}

export async function getAttempt(
	sessionId: string,
	attemptId: string,
): Promise<
	{ assistantText: string; id: string; status: (typeof conversationAttempt.$inferSelect)["status"] } | undefined
> {
	const [row] = await db
		.select({ id: conversationAttempt.id, status: conversationAttempt.status, assistantText: conversationMessage.text })
		.from(conversationAttempt)
		.innerJoin(
			conversationMessage,
			and(eq(conversationMessage.attemptId, conversationAttempt.id), eq(conversationMessage.role, "assistant")),
		)
		.where(and(eq(conversationAttempt.sessionId, sessionId), eq(conversationAttempt.id, attemptId)))
		.limit(1)
	return row
}

export async function recoverExpired(): Promise<void> {
	return db.transaction(async (tx) => {
		const now = new Date()
		await interruptExpiredAttempts(tx, or(sql`true`), now)
		await tx
			.delete(conversationDailyCounter)
			.where(lt(conversationDailyCounter.day, now.toISOString().slice(0, DATE_PREFIX_LENGTH)))
	})
}
