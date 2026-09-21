import { db } from "@/db/client.ts"
import { embed } from "@/modules/embed/embed.schema.ts"
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm"

import {
	ConcurrentGenerationLimitError,
	DailyAllowanceExceededError,
	RequestConflictError,
	SessionBusyError,
	SessionUnauthorizedError,
} from "./conversation.errors.ts"
import { conversation, conversationDailyCounter, generationAttempt, message } from "./conversation.schema.ts"

const ACTIVE_STATUSES = ["accepted", "running"] as const
const LEASE_MS = 15_000
const DATABASE_NOW = sql`now()`
const DATABASE_DAY = sql<string>`to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
const DATABASE_LEASE_EXPIRY = sql`now() + ${LEASE_MS} * interval '1 millisecond'`

export type ConversationContext = {
	agentId: string
	conversationId: string
	embedAccessVersion: number
	embedId: string
}

export type AcceptedGenerationAttempt = {
	assistantMessage: typeof message.$inferSelect
	generationAttempt: typeof generationAttempt.$inferSelect
	duplicate: boolean
	userMessage: typeof message.$inferSelect
}

// Control-flow signal for the acceptance retry loop, not mapped to an HTTP response.
export class StaleHistoryRepositoryError extends Error {}

export type HistorySnapshot = {
	latestCompletedMessageId: string | null
	messages: (typeof message.$inferSelect)[]
	revision: number
}

export type PendingUsageFinalization = {
	agentId: string
	assistantText: string
	generationAttemptId: string
	conversationId: string
	inputText: string
	inputTokens: number | null
	model: string
	outcome: NonNullable<typeof generationAttempt.$inferSelect.finalOutcome>
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

export async function findConversationById(conversationId: string): Promise<ConversationContext | undefined> {
	const [row] = await db
		.select({
			conversationId: conversation.id,
			embedId: conversation.embedId,
			embedAccessVersion: conversation.embedAccessVersion,
			agentId: conversation.agentId,
		})
		.from(conversation)
		.innerJoin(embed, and(eq(embed.id, conversation.embedId), eq(embed.accessVersion, conversation.embedAccessVersion)))
		.where(eq(conversation.id, conversationId))
		.limit(1)
	if (!row || !row.embedId) return undefined
	return { ...row, embedId: row.embedId }
}

export async function listMessages(conversationId: string): Promise<(typeof message.$inferSelect)[]> {
	return db
		.select()
		.from(message)
		.where(eq(message.conversationId, conversationId))
		.orderBy(asc(message.createdAt), asc(message.id))
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
			.from(message)
			.where(eq(message.conversationId, conversationId))
			.orderBy(asc(message.createdAt), asc(message.id))
		return { ...state, messages }
	})
}

async function interruptExpiredGenerationAttempts(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	condition?: ReturnType<typeof or>,
): Promise<void> {
	const expired = await tx
		.update(generationAttempt)
		.set({
			status: "interrupted",
			finalOutcome: sql`CASE WHEN ${generationAttempt.providerInvoked} THEN 'interrupted'::generation_attempt_final_outcome ELSE NULL END`,
			updatedAt: DATABASE_NOW,
		})
		.where(
			and(
				inArray(generationAttempt.status, ACTIVE_STATUSES),
				lt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
				condition,
			),
		)
		.returning({ id: generationAttempt.id })
	if (expired.length === 0) return
	await tx
		.update(message)
		.set({ outcome: "interrupted", updatedAt: DATABASE_NOW })
		.where(
			and(
				inArray(
					message.generationAttemptId,
					expired.map((expiredGenerationAttempt) => expiredGenerationAttempt.id),
				),
				eq(message.role, "assistant"),
			),
		)
}

export async function acceptGenerationAttempt(input: {
	agentId: string
	dailyLimit: number
	conversationId: string
	embedAccessVersion: number
	embedId: string
	inputText: string
	messageText: string
	networkHash: string
	requestId: string
	historyRevision: number
	historyTailId: string | null
	concurrencyLimit: number
}): Promise<AcceptedGenerationAttempt> {
	return db.transaction(async (tx) => {
		await acquireAcceptanceLocks(
			tx,
			`conversation:${input.conversationId}`,
			`network:${input.agentId}:${input.networkHash}`,
		)

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
		if (!validEmbed) throw new SessionUnauthorizedError()

		const [existingConversation] = await tx
			.select()
			.from(conversation)
			.where(eq(conversation.id, input.conversationId))
			.limit(1)
		if (existingConversation) {
			if (
				existingConversation.embedId !== input.embedId ||
				existingConversation.embedAccessVersion !== input.embedAccessVersion
			) {
				throw new SessionUnauthorizedError()
			}
		} else {
			await tx.insert(conversation).values({
				id: input.conversationId,
				agentId: input.agentId,
				embedId: input.embedId,
				embedAccessVersion: input.embedAccessVersion,
			})
		}
		await interruptExpiredGenerationAttempts(
			tx,
			or(
				eq(generationAttempt.conversationId, input.conversationId),
				and(
					eq(generationAttempt.networkHash, input.networkHash),
					sql`EXISTS (SELECT 1 FROM ${conversation} c WHERE c.id = ${generationAttempt.conversationId} AND c.agent_id = ${input.agentId})`,
				),
			),
		)

		const [duplicate] = await tx
			.select()
			.from(generationAttempt)
			.where(
				and(
					eq(generationAttempt.conversationId, input.conversationId),
					eq(generationAttempt.requestId, input.requestId),
				),
			)
			.limit(1)
		if (duplicate) {
			const messages = await tx.select().from(message).where(eq(message.generationAttemptId, duplicate.id))
			const userMessage = messages.find((storedMessage) => storedMessage.role === "user")
			const assistantMessage = messages.find((storedMessage) => storedMessage.role === "assistant")
			if (!userMessage || !assistantMessage) throw new Error("acceptGenerationAttempt: accepted pair incomplete")
			if (userMessage.text !== input.messageText) throw new RequestConflictError()
			return { generationAttempt: duplicate, userMessage, assistantMessage, duplicate: true }
		}
		const [historyState] = await tx
			.select({ revision: conversation.revision, latestCompletedMessageId: conversation.latestCompletedMessageId })
			.from(conversation)
			.where(eq(conversation.id, input.conversationId))
			.limit(1)
		if (
			!historyState ||
			historyState.revision !== input.historyRevision ||
			historyState.latestCompletedMessageId !== input.historyTailId
		) {
			throw new StaleHistoryRepositoryError()
		}

		const [conversationActive] = await tx
			.select({ value: count() })
			.from(generationAttempt)
			.where(
				and(
					eq(generationAttempt.conversationId, input.conversationId),
					inArray(generationAttempt.status, ACTIVE_STATUSES),
					gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
				),
			)
		if ((conversationActive?.value ?? 0) > 0) throw new SessionBusyError()
		const [networkActive] = await tx
			.select({ value: count() })
			.from(generationAttempt)
			.innerJoin(conversation, eq(conversation.id, generationAttempt.conversationId))
			.where(
				and(
					eq(conversation.agentId, input.agentId),
					eq(generationAttempt.networkHash, input.networkHash),
					inArray(generationAttempt.status, ACTIVE_STATUSES),
					gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
				),
			)
		if ((networkActive?.value ?? 0) >= input.concurrencyLimit) throw new ConcurrentGenerationLimitError()

		const [counter] = await tx
			.insert(conversationDailyCounter)
			.values({ agentId: input.agentId, networkHash: input.networkHash, day: DATABASE_DAY, count: 1 })
			.onConflictDoUpdate({
				target: [conversationDailyCounter.agentId, conversationDailyCounter.networkHash, conversationDailyCounter.day],
				set: { count: sql`${conversationDailyCounter.count} + 1`, updatedAt: DATABASE_NOW },
				setWhere: lt(conversationDailyCounter.count, input.dailyLimit),
			})
			.returning()
		if (!counter) throw new DailyAllowanceExceededError()

		const generationAttemptId = crypto.randomUUID()
		const leaseToken = crypto.randomUUID()
		const [generationAttemptRow] = await tx
			.insert(generationAttempt)
			.values({
				id: generationAttemptId,
				conversationId: input.conversationId,
				requestId: input.requestId,
				inputText: input.inputText,
				networkHash: input.networkHash,
				leaseToken,
				leaseExpiresAt: DATABASE_LEASE_EXPIRY,
			})
			.returning()
		if (!generationAttemptRow) throw new Error("acceptGenerationAttempt: insert returned no row")
		const [userMessage, assistantMessage] = await tx
			.insert(message)
			.values([
				{
					id: crypto.randomUUID(),
					conversationId: input.conversationId,
					generationAttemptId,
					role: "user",
					text: input.messageText,
					outcome: "completed",
					createdAt: DATABASE_NOW,
				},
				{
					id: crypto.randomUUID(),
					conversationId: input.conversationId,
					generationAttemptId,
					role: "assistant",
					text: "",
					outcome: "streaming",
					createdAt: sql`now() + interval '1 millisecond'`,
				},
			])
			.returning()
		if (!userMessage || !assistantMessage) throw new Error("acceptGenerationAttempt: insert returned no row")
		return { generationAttempt: generationAttemptRow, userMessage, assistantMessage, duplicate: false }
	})
}

export async function markRunning(generationAttemptId: string, leaseToken: string): Promise<boolean> {
	const rows = await db
		.update(generationAttempt)
		.set({ status: "running", updatedAt: DATABASE_NOW })
		.where(
			and(
				eq(generationAttempt.id, generationAttemptId),
				eq(generationAttempt.leaseToken, leaseToken),
				eq(generationAttempt.status, "accepted"),
				gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
			),
		)
		.returning({ id: generationAttempt.id })
	return rows.length === 1
}

export async function appendOutput(generationAttemptId: string, leaseToken: string, text: string): Promise<boolean> {
	const rows = await db
		.update(message)
		.set({ text: sql`${message.text} || ${text}`, updatedAt: DATABASE_NOW })
		.where(
			and(
				eq(message.generationAttemptId, generationAttemptId),
				eq(message.role, "assistant"),
				sql`EXISTS (SELECT 1 FROM ${generationAttempt} a WHERE a.id = ${generationAttemptId} AND a.lease_token = ${leaseToken} AND a.status = 'running' AND a.lease_expires_at > now())`,
			),
		)
		.returning({ id: message.id })
	return rows.length === 1
}

export async function setAttribution(
	generationAttemptId: string,
	leaseToken: string,
	provider: string,
	model: string,
	markInvoked = false,
): Promise<boolean> {
	const rows = await db
		.update(generationAttempt)
		.set({ provider, model, ...(markInvoked ? { providerInvoked: true } : {}), updatedAt: DATABASE_NOW })
		.where(
			and(
				eq(generationAttempt.id, generationAttemptId),
				eq(generationAttempt.leaseToken, leaseToken),
				eq(generationAttempt.status, "running"),
				gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
			),
		)
		.returning({ id: generationAttempt.id })
	return rows.length === 1
}

export async function heartbeat(generationAttemptId: string, leaseToken: string): Promise<boolean> {
	const rows = await db
		.update(generationAttempt)
		.set({ leaseExpiresAt: DATABASE_LEASE_EXPIRY, updatedAt: DATABASE_NOW })
		.where(
			and(
				eq(generationAttempt.id, generationAttemptId),
				eq(generationAttempt.leaseToken, leaseToken),
				eq(generationAttempt.status, "running"),
				gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
			),
		)
		.returning({ id: generationAttempt.id })
	return rows.length === 1
}

export async function isCancellationRequested(generationAttemptId: string, leaseToken: string): Promise<boolean> {
	const [row] = await db
		.select({ cancelled: generationAttempt.cancellationRequestedAt })
		.from(generationAttempt)
		.where(
			and(
				eq(generationAttempt.id, generationAttemptId),
				eq(generationAttempt.leaseToken, leaseToken),
				gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
			),
		)
	return row?.cancelled !== null && row?.cancelled !== undefined
}

export async function stageFinalization(input: {
	generationAttemptId: string
	inputTokens: number
	leaseToken: string
	model: string
	outcome: "blocked" | "cancelled" | "completed" | "failed" | "interrupted"
	outputTokens: number
	provider: string
}): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [generationAttemptContext] = await tx
			.select({ conversationId: generationAttempt.conversationId })
			.from(generationAttempt)
			.where(eq(generationAttempt.id, input.generationAttemptId))
			.limit(1)
		if (!generationAttemptContext) return false
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`1:conversation:${generationAttemptContext.conversationId}`}, 0))`,
		)
		const rows = await tx
			.update(generationAttempt)
			.set({
				status: input.outcome,
				finalOutcome: input.outcome,
				provider: input.provider,
				model: input.model,
				usageInputTokens: input.inputTokens,
				usageOutputTokens: input.outputTokens,
				updatedAt: DATABASE_NOW,
			})
			.where(
				and(
					eq(generationAttempt.id, input.generationAttemptId),
					eq(generationAttempt.leaseToken, input.leaseToken),
					eq(generationAttempt.status, "running"),
					eq(generationAttempt.providerInvoked, true),
					gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
				),
			)
			.returning({ conversationId: generationAttempt.conversationId })
		const finalized = rows[0]
		if (!finalized) return false
		const [assistant] = await tx
			.update(message)
			.set({ outcome: input.outcome, updatedAt: DATABASE_NOW })
			.where(and(eq(message.generationAttemptId, input.generationAttemptId), eq(message.role, "assistant")))
			.returning({ id: message.id })
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

export async function listPendingUsageFinalizations(limit: number): Promise<PendingUsageFinalization[]> {
	return db
		.select({
			generationAttemptId: generationAttempt.id,
			conversationId: generationAttempt.conversationId,
			agentId: conversation.agentId,
			inputText: generationAttempt.inputText,
			assistantText: message.text,
			provider: sql<string>`coalesce(${generationAttempt.provider}, 'unknown')`,
			model: sql<string>`coalesce(${generationAttempt.model}, 'unknown')`,
			outcome: generationAttempt.finalOutcome,
			inputTokens: generationAttempt.usageInputTokens,
			outputTokens: generationAttempt.usageOutputTokens,
		})
		.from(generationAttempt)
		.innerJoin(conversation, eq(conversation.id, generationAttempt.conversationId))
		.innerJoin(message, and(eq(message.generationAttemptId, generationAttempt.id), eq(message.role, "assistant")))
		.where(
			and(
				eq(generationAttempt.providerInvoked, true),
				isNotNull(generationAttempt.finalOutcome),
				isNull(generationAttempt.usageRecordedAt),
			),
		)
		.limit(limit) as Promise<PendingUsageFinalization[]>
}

export async function stageRecoveredUsageCandidate(
	generationAttemptId: string,
	outcome: PendingUsageFinalization["outcome"],
	inputTokens: number,
	outputTokens: number,
): Promise<boolean> {
	const rows = await db
		.update(generationAttempt)
		.set({ usageInputTokens: inputTokens, usageOutputTokens: outputTokens, updatedAt: DATABASE_NOW })
		.where(
			and(
				eq(generationAttempt.id, generationAttemptId),
				eq(generationAttempt.finalOutcome, outcome),
				eq(generationAttempt.providerInvoked, true),
				isNull(generationAttempt.usageInputTokens),
				isNull(generationAttempt.usageOutputTokens),
				isNull(generationAttempt.usageRecordedAt),
			),
		)
		.returning({ id: generationAttempt.id })
	return rows.length === 1
}

export async function markUsageRecorded(input: {
	generationAttemptId: string
	inputTokens: number
	outcome: PendingUsageFinalization["outcome"]
	outputTokens: number
}): Promise<boolean> {
	const rows = await db
		.update(generationAttempt)
		.set({ usageRecordedAt: DATABASE_NOW, updatedAt: DATABASE_NOW })
		.where(
			and(
				eq(generationAttempt.id, input.generationAttemptId),
				eq(generationAttempt.finalOutcome, input.outcome),
				eq(generationAttempt.usageInputTokens, input.inputTokens),
				eq(generationAttempt.usageOutputTokens, input.outputTokens),
				isNull(generationAttempt.usageRecordedAt),
			),
		)
		.returning({ id: generationAttempt.id })
	return rows.length === 1
}

export async function requestCancellation(conversationId: string, generationAttemptId?: string): Promise<boolean> {
	const conditions = [
		eq(generationAttempt.conversationId, conversationId),
		inArray(generationAttempt.status, ACTIVE_STATUSES),
		gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
	]
	if (generationAttemptId) conditions.push(eq(generationAttempt.id, generationAttemptId))
	const rows = await db
		.update(generationAttempt)
		.set({ cancellationRequestedAt: DATABASE_NOW, updatedAt: DATABASE_NOW })
		.where(and(...conditions))
		.returning({ id: generationAttempt.id })
	return rows.length > 0
}

export async function getActiveGenerationAttempt(conversationId: string): Promise<{ id: string } | undefined> {
	const [row] = await db
		.select({ id: generationAttempt.id })
		.from(generationAttempt)
		.where(
			and(
				eq(generationAttempt.conversationId, conversationId),
				inArray(generationAttempt.status, ACTIVE_STATUSES),
				gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
			),
		)
		.limit(1)
	return row
}

export async function recoverExpiredGenerationAttempts(): Promise<void> {
	return db.transaction(async (tx) => {
		await interruptExpiredGenerationAttempts(tx)
		await tx.delete(conversationDailyCounter).where(lt(conversationDailyCounter.day, DATABASE_DAY))
	})
}
