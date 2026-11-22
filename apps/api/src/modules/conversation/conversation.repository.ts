import { db } from "@/db/client.ts"
import { embed } from "@/modules/embed/embed.schema.ts"
import { and, asc, count, countDistinct, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm"

import {
	ConcurrentGenerationLimitError,
	ConversationNotFoundError,
	DailyAllowanceExceededError,
	EmbedDisabledError,
	RequestConflictError,
	SessionBusyError,
	SessionUnauthorizedError,
} from "./conversation.errors.ts"
import {
	conversation,
	conversationDailyCounter,
	GENERATION_ATTEMPT_ACTIVE_STATUSES,
	generationAttempt,
	type GenerationAttemptOutcome,
	message,
} from "./conversation.schema.ts"

const LEASE_MS = 15_000
const DAILY_COUNTER_PRUNE_BATCH_SIZE = 1_000
const DATABASE_NOW = sql`now()`
const DATABASE_DAY = sql<string>`to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
const DATABASE_LEASE_EXPIRY = sql`now() + ${LEASE_MS} * interval '1 millisecond'`

function activeUnexpired() {
	return and(
		inArray(generationAttempt.status, GENERATION_ATTEMPT_ACTIVE_STATUSES),
		gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
	)
}

function leaseOwned(generationAttemptId: string, leaseToken: string) {
	return and(
		eq(generationAttempt.id, generationAttemptId),
		eq(generationAttempt.leaseToken, leaseToken),
		gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
	)
}

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
	estimatedInputTokens: number
	inputTokens: number | null
	model: string
	outcome: NonNullable<typeof generationAttempt.$inferSelect.finalOutcome>
	outputTokens: number | null
	provider: string
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type AcceptanceBase = {
	agentId: string
	conversationId: string
	estimatedInputTokens: number
	messageText: string
	requestId: string
	historyRevision: number
	historyTailId: string | null
	concurrencyLimit: number
}

type EmbedAcceptance = AcceptanceBase & {
	origin: "embed"
	dailyLimit: number
	embedAccessVersion: number
	embedId: string
	networkHash: string
}

type DashboardAcceptance = AcceptanceBase & { origin: "dashboard"; operatorId: string }

type AcceptanceInput = EmbedAcceptance | DashboardAcceptance

async function acquireAcceptanceLocks(tx: Transaction, identityKey: string, admissionKey: string): Promise<void> {
	// The numeric prefixes lock identity before admission scope so concurrent requests share one order.
	for (const key of [`1:${identityKey}`, `2:${admissionKey}`]) {
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
	if (!row?.embedId || row.embedAccessVersion === null) return undefined
	return { ...row, embedId: row.embedId, embedAccessVersion: row.embedAccessVersion }
}

export async function findDashboardConversation(input: {
	agentId: string
	conversationId: string
	operatorId: string
}): Promise<{ conversationId: string } | undefined> {
	const [row] = await db
		.select({ conversationId: conversation.id })
		.from(conversation)
		.where(dashboardConversationOwned(input))
		.limit(1)
	return row
}

const isTestChat = isNull(conversation.embedAccessVersion)

function dashboardConversationOwned(input: { agentId: string; conversationId: string; operatorId: string }) {
	return and(
		eq(conversation.id, input.conversationId),
		isTestChat,
		eq(conversation.agentId, input.agentId),
		eq(conversation.operatorId, input.operatorId),
	)
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
				inArray(generationAttempt.status, GENERATION_ATTEMPT_ACTIVE_STATUSES),
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

async function lockValidEmbed(tx: Transaction, input: EmbedAcceptance): Promise<void> {
	const [validEmbed] = await tx
		.select({ id: embed.id, isDisabled: embed.isDisabled })
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
	// Row-locked check: a disable racing acceptance either lands first here or after it.
	if (validEmbed.isDisabled) throw new EmbedDisabledError()
}

async function ensureConversation(tx: Transaction, input: AcceptanceInput): Promise<void> {
	const [existingConversation] = await tx
		.select()
		.from(conversation)
		.where(eq(conversation.id, input.conversationId))
		.limit(1)
	if (existingConversation) {
		assertConversationIdentity(existingConversation, input)
		return
	}
	await tx.insert(conversation).values(
		input.origin === "embed"
			? {
					id: input.conversationId,
					agentId: input.agentId,
					embedId: input.embedId,
					embedAccessVersion: input.embedAccessVersion,
				}
			: { id: input.conversationId, agentId: input.agentId, operatorId: input.operatorId },
	)
}

function assertConversationIdentity(existing: typeof conversation.$inferSelect, input: AcceptanceInput): void {
	if (input.origin === "embed") {
		if (existing.embedId !== input.embedId || existing.embedAccessVersion !== input.embedAccessVersion) {
			throw new SessionUnauthorizedError()
		}
		return
	}
	// A client-chosen ID that collides with someone else's conversation must not reveal it exists.
	if (
		existing.embedAccessVersion !== null ||
		existing.agentId !== input.agentId ||
		existing.operatorId !== input.operatorId
	) {
		throw new ConversationNotFoundError()
	}
}

function findMessagePair(messages: (typeof message.$inferSelect)[]): {
	assistantMessage: typeof message.$inferSelect
	userMessage: typeof message.$inferSelect
} {
	const userMessage = messages.find((storedMessage) => storedMessage.role === "user")
	const assistantMessage = messages.find((storedMessage) => storedMessage.role === "assistant")
	if (!userMessage || !assistantMessage) throw new Error("acceptGenerationAttempt: accepted pair incomplete")
	return { userMessage, assistantMessage }
}

async function findAcceptedDuplicate(
	tx: Transaction,
	input: AcceptanceInput,
): Promise<AcceptedGenerationAttempt | undefined> {
	const [duplicate] = await tx
		.select()
		.from(generationAttempt)
		.where(
			and(eq(generationAttempt.conversationId, input.conversationId), eq(generationAttempt.requestId, input.requestId)),
		)
		.limit(1)
	if (!duplicate) return undefined
	const { userMessage, assistantMessage } = findMessagePair(
		await tx.select().from(message).where(eq(message.generationAttemptId, duplicate.id)),
	)
	if (userMessage.text !== input.messageText) throw new RequestConflictError()
	return { generationAttempt: duplicate, userMessage, assistantMessage, duplicate: true }
}

async function assertHistoryCurrent(tx: Transaction, input: AcceptanceInput): Promise<void> {
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
}

async function conversationActiveCount(tx: Transaction, conversationId: string): Promise<number> {
	const [row] = await tx
		.select({ value: count() })
		.from(generationAttempt)
		.where(and(eq(generationAttempt.conversationId, conversationId), activeUnexpired()))
	return row?.value ?? 0
}

async function networkActiveCount(tx: Transaction, input: EmbedAcceptance): Promise<number> {
	const [row] = await tx
		.select({ value: count() })
		.from(generationAttempt)
		.innerJoin(conversation, eq(conversation.id, generationAttempt.conversationId))
		.where(
			and(
				eq(conversation.agentId, input.agentId),
				eq(generationAttempt.networkHash, input.networkHash),
				activeUnexpired(),
			),
		)
	return row?.value ?? 0
}

async function operatorActiveCount(tx: Transaction, input: DashboardAcceptance): Promise<number> {
	const [row] = await tx
		.select({ value: count() })
		.from(generationAttempt)
		.innerJoin(conversation, eq(conversation.id, generationAttempt.conversationId))
		.where(
			and(eq(conversation.agentId, input.agentId), eq(conversation.operatorId, input.operatorId), activeUnexpired()),
		)
	return row?.value ?? 0
}

async function reserveDailyAllowance(tx: Transaction, input: EmbedAcceptance): Promise<void> {
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
}

async function insertAcceptedGeneration(tx: Transaction, input: AcceptanceInput): Promise<AcceptedGenerationAttempt> {
	const generationAttemptId = crypto.randomUUID()
	const leaseToken = crypto.randomUUID()
	const [generationAttemptRow] = await tx
		.insert(generationAttempt)
		.values({
			id: generationAttemptId,
			conversationId: input.conversationId,
			requestId: input.requestId,
			estimatedInputTokens: input.estimatedInputTokens,
			networkHash: input.origin === "embed" ? input.networkHash : null,
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
}

async function assertAdmission(tx: Transaction, input: AcceptanceInput): Promise<void> {
	if ((await conversationActiveCount(tx, input.conversationId)) > 0) throw new SessionBusyError()
	if (input.origin === "dashboard") {
		// Operators are authenticated, so only concurrency bounds them; no daily allowance.
		if ((await operatorActiveCount(tx, input)) >= input.concurrencyLimit) throw new ConcurrentGenerationLimitError()
		return
	}
	if ((await networkActiveCount(tx, input)) >= input.concurrencyLimit) throw new ConcurrentGenerationLimitError()
	await reserveDailyAllowance(tx, input)
}

function admissionLockKey(input: AcceptanceInput): string {
	return input.origin === "embed"
		? `network:${input.agentId}:${input.networkHash}`
		: `operator:${input.agentId}:${input.operatorId}`
}

function admissionScope(input: AcceptanceInput) {
	return input.origin === "embed"
		? and(
				eq(generationAttempt.networkHash, input.networkHash),
				sql`EXISTS (SELECT 1 FROM ${conversation} c WHERE c.id = ${generationAttempt.conversationId} AND c.agent_id = ${input.agentId})`,
			)
		: sql`EXISTS (SELECT 1 FROM ${conversation} c WHERE c.id = ${generationAttempt.conversationId} AND c.agent_id = ${input.agentId} AND c.operator_id = ${input.operatorId})`
}

export async function acceptGenerationAttempt(input: AcceptanceInput): Promise<AcceptedGenerationAttempt> {
	return db.transaction(async (tx) => {
		await acquireAcceptanceLocks(tx, `conversation:${input.conversationId}`, admissionLockKey(input))
		if (input.origin === "embed") await lockValidEmbed(tx, input)
		await ensureConversation(tx, input)
		await interruptExpiredGenerationAttempts(
			tx,
			or(eq(generationAttempt.conversationId, input.conversationId), admissionScope(input)),
		)
		const duplicate = await findAcceptedDuplicate(tx, input)
		if (duplicate) return duplicate
		await assertHistoryCurrent(tx, input)
		await assertAdmission(tx, input)
		return insertAcceptedGeneration(tx, input)
	})
}

export async function markRunning(generationAttemptId: string, leaseToken: string): Promise<boolean> {
	const rows = await db
		.update(generationAttempt)
		.set({ status: "running", updatedAt: DATABASE_NOW })
		.where(and(leaseOwned(generationAttemptId, leaseToken), eq(generationAttempt.status, "accepted")))
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
	estimatedInputTokens?: number,
): Promise<boolean> {
	const rows = await db
		.update(generationAttempt)
		.set({
			provider,
			model,
			...(markInvoked ? { providerInvoked: true } : {}),
			...(estimatedInputTokens !== undefined ? { estimatedInputTokens } : {}),
			updatedAt: DATABASE_NOW,
		})
		.where(and(leaseOwned(generationAttemptId, leaseToken), eq(generationAttempt.status, "running")))
		.returning({ id: generationAttempt.id })
	return rows.length === 1
}

export async function pollRunningAttempts(
	owned: { id: string; leaseToken: string }[],
	renewLease: boolean,
): Promise<{ id: string; cancelled: boolean }[]> {
	if (owned.length === 0) return []
	const matches = sql`(${generationAttempt.id}, ${generationAttempt.leaseToken}) IN (${sql.join(
		owned.map(({ id, leaseToken }) => sql`(${id}, ${leaseToken})`),
		sql`, `,
	)})`
	const condition = and(
		matches,
		eq(generationAttempt.status, "running"),
		gt(generationAttempt.leaseExpiresAt, DATABASE_NOW),
	)
	const fields = { id: generationAttempt.id, cancelledAt: generationAttempt.cancellationRequestedAt }
	const rows = renewLease
		? await db
				.update(generationAttempt)
				.set({ leaseExpiresAt: DATABASE_LEASE_EXPIRY, updatedAt: DATABASE_NOW })
				.where(condition)
				.returning(fields)
		: await db.select(fields).from(generationAttempt).where(condition)
	return rows.map((row) => ({ id: row.id, cancelled: row.cancelledAt !== null }))
}

export async function stageFinalization(input: {
	generationAttemptId: string
	inputTokens: number
	leaseToken: string
	model: string
	outcome: GenerationAttemptOutcome
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
			.where(and(leaseOwned(input.generationAttemptId, input.leaseToken), eq(generationAttempt.status, "running")))
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

export async function listPendingUsageFinalizations(limit: number, id?: string): Promise<PendingUsageFinalization[]> {
	return db
		.select({
			generationAttemptId: generationAttempt.id,
			conversationId: generationAttempt.conversationId,
			agentId: conversation.agentId,
			estimatedInputTokens: generationAttempt.estimatedInputTokens,
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
				id ? eq(generationAttempt.id, id) : undefined,
			),
		)
		.orderBy(asc(generationAttempt.id))
		.limit(limit) as Promise<PendingUsageFinalization[]>
}

export async function stageRecoveredUsageCandidate(
	generationAttemptId: string,
	outcome: PendingUsageFinalization["outcome"],
	inputTokens: number,
	outputTokens: number,
): Promise<void> {
	await db
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
}

export async function markUsageRecorded(input: {
	generationAttemptId: string
	inputTokens: number
	outcome: PendingUsageFinalization["outcome"]
	outputTokens: number
}): Promise<void> {
	await db
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
}

export async function requestCancellation(conversationId: string, generationAttemptId?: string): Promise<string[]> {
	const conditions = [eq(generationAttempt.conversationId, conversationId), activeUnexpired()]
	if (generationAttemptId) conditions.push(eq(generationAttempt.id, generationAttemptId))
	const rows = await db
		.update(generationAttempt)
		.set({ cancellationRequestedAt: DATABASE_NOW, updatedAt: DATABASE_NOW })
		.where(and(...conditions))
		.returning({ id: generationAttempt.id })
	return rows.map((row) => row.id)
}

export async function getActiveGenerationAttempt(conversationId: string): Promise<{ id: string } | undefined> {
	const [row] = await db
		.select({ id: generationAttempt.id })
		.from(generationAttempt)
		.where(and(eq(generationAttempt.conversationId, conversationId), activeUnexpired()))
		.limit(1)
	return row
}

export async function recoverExpiredGenerationAttempts(): Promise<void> {
	return db.transaction(async (tx) => {
		await interruptExpiredGenerationAttempts(tx)
	})
}

export async function pruneDailyCounters(): Promise<void> {
	await db.delete(conversationDailyCounter).where(
		and(
			lt(conversationDailyCounter.day, DATABASE_DAY),
			sql`(${conversationDailyCounter.agentId}, ${conversationDailyCounter.networkHash}, ${conversationDailyCounter.day}) IN (${db
				.select({
					agentId: conversationDailyCounter.agentId,
					networkHash: conversationDailyCounter.networkHash,
					day: conversationDailyCounter.day,
				})
				.from(conversationDailyCounter)
				.where(lt(conversationDailyCounter.day, DATABASE_DAY))
				.limit(DAILY_COUNTER_PRUNE_BATCH_SIZE)})`,
		),
	)
}

export type AgentDailyCount = {
	agentId: string
	count: number
	date: string
}

// Dashboard test chats stay out of every visitor-facing listing and count; their usage does not.
const fromEmbed = isNotNull(conversation.embedAccessVersion)
const conversationDay = sql<string>`to_char(${conversation.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
const messageDay = sql<string>`to_char(${message.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`

// Sparse per-agent daily series: days without activity have no row, the consumer zero-fills.
export async function getDailyConversationCountsByAgent(
	since: Date,
	scope: readonly string[] | "all",
): Promise<AgentDailyCount[]> {
	return db
		.select({ agentId: conversation.agentId, date: conversationDay, count: count() })
		.from(conversation)
		.where(
			and(
				fromEmbed,
				gte(conversation.createdAt, since),
				scope === "all" ? undefined : inArray(conversation.agentId, [...scope]),
			),
		)
		.groupBy(conversation.agentId, conversationDay)
		.orderBy(conversation.agentId, conversationDay)
}

export async function getDailyMessageCountsByAgent(
	since: Date,
	scope: readonly string[] | "all",
): Promise<AgentDailyCount[]> {
	return db
		.select({ agentId: conversation.agentId, date: messageDay, count: count() })
		.from(message)
		.innerJoin(conversation, eq(message.conversationId, conversation.id))
		.where(
			and(
				fromEmbed,
				gte(message.createdAt, since),
				scope === "all" ? undefined : inArray(conversation.agentId, [...scope]),
			),
		)
		.groupBy(conversation.agentId, messageDay)
		.orderBy(conversation.agentId, messageDay)
}

export type AgentConversationCount = {
	agentId: string
	count: number
}

// Conversations touched by any message since the cutoff, counted per owning agent.
export async function getActiveConversationCountsByAgent(
	cutoff: Date,
	scope: readonly string[] | "all",
): Promise<AgentConversationCount[]> {
	return db
		.select({ agentId: conversation.agentId, count: countDistinct(message.conversationId) })
		.from(message)
		.innerJoin(conversation, eq(message.conversationId, conversation.id))
		.where(
			and(
				fromEmbed,
				gte(message.createdAt, cutoff),
				scope === "all" ? undefined : inArray(conversation.agentId, [...scope]),
			),
		)
		.groupBy(conversation.agentId)
		.orderBy(conversation.agentId)
}

export type ConversationSummaryRow = {
	agentId: string
	createdAt: Date
	messageCount: number
	preview: string | null
	referenceId: string
}

export async function listConversations(input: {
	agentIds: string[] | undefined
	limit: number
	offset: number
	previewLength: number
}): Promise<{ rows: ConversationSummaryRow[]; total: number }> {
	const where = and(fromEmbed, input.agentIds ? inArray(conversation.agentId, input.agentIds) : undefined)
	const [rows, [counted]] = await Promise.all([
		db
			.select({
				referenceId: conversation.referenceId,
				agentId: conversation.agentId,
				createdAt: conversation.createdAt,
				messageCount: sql<number>`(SELECT count(*)::int FROM message m WHERE m.conversation_id = conversation.id)`,
				preview: sql<
					string | null
				>`(SELECT left(m.text, ${input.previewLength}) FROM message m WHERE m.conversation_id = conversation.id AND m.role = 'user' ORDER BY m.created_at, m.id LIMIT 1)`,
			})
			.from(conversation)
			.where(where)
			.orderBy(desc(conversation.createdAt), desc(conversation.referenceId))
			.limit(input.limit)
			.offset(input.offset),
		db.select({ total: count() }).from(conversation).where(where),
	])
	return { rows, total: counted?.total ?? 0 }
}

export async function findConversationByReference(
	referenceId: string,
): Promise<{ agentId: string; createdAt: Date; id: string; referenceId: string } | undefined> {
	const [row] = await db
		.select({
			id: conversation.id,
			agentId: conversation.agentId,
			referenceId: conversation.referenceId,
			createdAt: conversation.createdAt,
		})
		.from(conversation)
		.where(and(fromEmbed, eq(conversation.referenceId, referenceId)))
		.limit(1)
	return row
}
