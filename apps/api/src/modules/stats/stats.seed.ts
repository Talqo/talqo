import { db, sql } from "@/db/client.ts"
import { conversation, generationAttempt, message } from "@/modules/conversation/conversation.schema.ts"
import { usageRecord } from "@/modules/usage/usage.schema.ts"
import { estimateTokens } from "@/modules/usage/usage.service.ts"

// Development statistics fixtures: a deterministic month of plausible traffic across the seeded
// agents so the dashboard renders real series. Runs once; the marker prefix keeps later seeds off.
const DAYS = 30
const INSERT_CHUNK_SIZE = 300
const MARKER_PREFIX = "seed-stats-"
const MILLISECONDS_PER_MINUTE = 60_000
// Matches the API's active-conversation window so the refreshed fixtures count as active.
const ACTIVE_WINDOW_MINUTES = 60
const MILLISECONDS_PER_DAY = 86_400_000
const MESSAGE_GAP_MS = 45_000
const MESSAGES_PER_TURN = 2
const MIN_TURNS = 2
const EXTRA_TURNS_SPAN = 3
const WEEKEND_FACTOR = 0.55
const SUNDAY_WEEKDAY = 0
const SATURDAY_WEEKDAY = 6
const VOLUME_MIN_FACTOR = 0.6
const VOLUME_RANDOM_SPAN = 0.8
const INTRA_DAY_POSITION_SPAN = 0.92
// Active-window conversations stay safely inside the API's 60-minute activity window.
const ACTIVE_START_MINUTES_AGO = 12
const ACTIVE_START_JITTER_MINUTES = 2
const INPUT_TOKENS_PER_TURN_MIN = 520
const INPUT_TOKENS_PER_TURN_SPAN = 560
const OUTPUT_TOKENS_PER_TURN_MIN = 70
const OUTPUT_TOKENS_PER_TURN_SPAN = 130
const AGENT_HASH_SPAN = 100_000
const DAY_HASH_STEP = 997
const ACTIVE_HASH_BASE = 777_000
// mulberry32 mixing constants; see https://github.com/bryc/code/blob/master/jshash/PRNGs.md
const MULBERRY_MIX_INCREMENT = 0x6d2b79f5
const MULBERRY_SHIFT_FIRST = 15
const MULBERRY_SHIFT_SECOND = 7
const MULBERRY_XOR_ADDEND = 61
const MULBERRY_SHIFT_THIRD = 14
const UINT32_BUCKET_COUNT = 4_294_967_296

const SEED_AGENT_IDS = [
	"11111111-1111-4111-8111-111111111111", // Website Assistant
	"33333333-3333-4333-8333-333333333333", // Product Advisor
	"44444444-4444-4444-8444-444444444444", // Docs Assistant
] as const

type SeedAgentProfile = {
	agentId: string
	// Mean conversations per day before weekend and trend adjustments.
	scale: number
	// Daily growth added per day towards today, so older days trend lower.
	growthPerDay: number
	quietDayProbability: number
}

const AGENT_PROFILES: SeedAgentProfile[] = [
	{ agentId: SEED_AGENT_IDS[0], scale: 6, growthPerDay: 0.005, quietDayProbability: 0.06 },
	{ agentId: SEED_AGENT_IDS[1], scale: 4, growthPerDay: 0.02, quietDayProbability: 0.1 },
	{ agentId: SEED_AGENT_IDS[2], scale: 2.5, growthPerDay: 0, quietDayProbability: 0.22 },
]

const USER_LINES = [
	"Where can I see your pricing tiers?",
	"How do I reset my password?",
	"Is there an API for the analytics data?",
	"Can I export my conversation history?",
	"What is the difference between the two plans?",
	"Do you support single sign-on?",
]

const ASSISTANT_LINES = [
	"You can find that in the account settings under Billing.",
	"I can help with that. Start from the dashboard and open Account.",
	"Yes, the public API covers it. You will find examples in the docs.",
	"Exports are available from the dashboard once you are signed in.",
	"The main difference is the usage allowance and priority support.",
	"Single sign-on is available on the business plan.",
]

let sequence = 0

function nextId(kind: string): string {
	sequence += 1
	return `${MARKER_PREFIX}${sequence}-${kind}`
}

function line(bank: readonly string[], index: number): string {
	return bank[index % bank.length] ?? "…"
}

// Deterministic PRNG keeps repeated seeds reproducible.
function mulberry32(initialState: number): () => number {
	let state = initialState >>> 0
	return () => {
		state = (state + MULBERRY_MIX_INCREMENT) >>> 0
		let value = state
		value = Math.imul(value ^ (value >>> MULBERRY_SHIFT_FIRST), value | 1)
		value ^= value + Math.imul(value ^ (value >>> MULBERRY_SHIFT_SECOND), value | MULBERRY_XOR_ADDEND)
		return ((value ^ (value >>> MULBERRY_SHIFT_THIRD)) >>> 0) / UINT32_BUCKET_COUNT
	}
}

type PlannedRowSets = {
	attempts: (typeof generationAttempt.$inferInsert)[]
	conversations: (typeof conversation.$inferInsert)[]
	messages: (typeof message.$inferInsert)[]
	usages: (typeof usageRecord.$inferInsert)[]
}

function planConversation(agentId: string, startedAt: Date, turns: number, rng: () => number): PlannedRowSets {
	const conversationId = nextId("conversation")
	const attemptId = nextId("attempt")
	const base = startedAt.getTime()
	const inputTokens = turns * (INPUT_TOKENS_PER_TURN_MIN + Math.floor(rng() * INPUT_TOKENS_PER_TURN_SPAN))
	const outputTokens = turns * (OUTPUT_TOKENS_PER_TURN_MIN + Math.floor(rng() * OUTPUT_TOKENS_PER_TURN_SPAN))
	const messages: PlannedRowSets["messages"] = []
	for (let index = 0; index < turns * MESSAGES_PER_TURN; index += 1) {
		const createdAt = new Date(base + index * MESSAGE_GAP_MS)
		messages.push({
			id: nextId("message"),
			conversationId,
			generationAttemptId: attemptId,
			role: index % MESSAGES_PER_TURN === 0 ? "user" : "assistant",
			text:
				index % MESSAGES_PER_TURN === 0
					? line(USER_LINES, index / MESSAGES_PER_TURN)
					: line(ASSISTANT_LINES, (index - 1) / MESSAGES_PER_TURN),
			outcome: "completed",
			createdAt,
			updatedAt: createdAt,
		})
	}
	const lastMessageAt = messages[messages.length - 1]?.createdAt ?? startedAt
	// Fully finalized attempts: anything less looks "pending" to the usage finalization drain
	// and conflicts with the matching usage_record.
	return {
		conversations: [{ id: conversationId, agentId, embedAccessVersion: 1, createdAt: startedAt }],
		attempts: [
			{
				id: attemptId,
				conversationId,
				requestId: nextId("request"),
				estimatedInputTokens: estimateTokens(line(USER_LINES, 0)),
				networkHash: "seed-network",
				leaseToken: nextId("lease"),
				leaseExpiresAt: new Date(base + MILLISECONDS_PER_MINUTE),
				status: "completed",
				finalOutcome: "completed",
				provider: "seed",
				model: "chat-model",
				providerInvoked: true,
				usageInputTokens: inputTokens,
				usageOutputTokens: outputTokens,
				usageRecordedAt: lastMessageAt,
				createdAt: startedAt,
				updatedAt: lastMessageAt,
			},
		],
		messages,
		usages: [
			{
				generationAttemptId: attemptId,
				agentId,
				conversationId,
				provider: "seed",
				model: "chat-model",
				outcome: "completed",
				inputTokens,
				outputTokens,
				createdAt: lastMessageAt,
			},
		],
	}
}

function dayStartUtc(daysAgo: number): Date {
	const day = new Date()
	day.setUTCHours(0, 0, 0, 0)
	day.setUTCDate(day.getUTCDate() - daysAgo)
	return day
}

function planRows(now: Date): PlannedRowSets {
	const rows: PlannedRowSets = { attempts: [], conversations: [], messages: [], usages: [] }
	const merge = (planned: PlannedRowSets) => {
		rows.conversations.push(...planned.conversations)
		rows.attempts.push(...planned.attempts)
		rows.messages.push(...planned.messages)
		rows.usages.push(...planned.usages)
	}
	for (const [agentIndex, profile] of AGENT_PROFILES.entries()) {
		for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
			const rng = mulberry32((agentIndex + 1) * AGENT_HASH_SPAN + daysAgo * DAY_HASH_STEP)
			const dayStart = dayStartUtc(daysAgo)
			// Today's traffic only fills the elapsed part of the day.
			const daySpanMs = daysAgo === 0 ? Math.max(now.getTime() - dayStart.getTime(), 1) : MILLISECONDS_PER_DAY
			const weekday = dayStart.getUTCDay()
			const weekend = weekday === SUNDAY_WEEKDAY || weekday === SATURDAY_WEEKDAY ? WEEKEND_FACTOR : 1
			const trend = 1 + (DAYS - 1 - daysAgo) * profile.growthPerDay
			const mean = profile.scale * weekend * trend
			if (daysAgo > 0 && rng() < profile.quietDayProbability) continue
			const count = Math.max(1, Math.round(mean * (VOLUME_MIN_FACTOR + rng() * VOLUME_RANDOM_SPAN)))
			for (let index = 0; index < count; index += 1) {
				const turns = MIN_TURNS + Math.floor(rng() * EXTRA_TURNS_SPAN)
				const conversationSpanMs = turns * MESSAGES_PER_TURN * MESSAGE_GAP_MS
				const start = new Date(
					dayStart.getTime() + Math.floor(rng() * INTRA_DAY_POSITION_SPAN * daySpanMs) + MILLISECONDS_PER_MINUTE,
				)
				// Early-morning seeds: skip starts that would run messages into the future.
				if (start.getTime() + conversationSpanMs > now.getTime()) continue
				merge(planConversation(profile.agentId, start, turns, rng))
			}
		}
	}
	// Guaranteed recent traffic so the live activity card shows figures right after seeding.
	for (const agentId of [SEED_AGENT_IDS[0], SEED_AGENT_IDS[1]]) {
		const rng = mulberry32(ACTIVE_HASH_BASE + sequence)
		const minutesAgo = ACTIVE_START_MINUTES_AGO + rng() * ACTIVE_START_JITTER_MINUTES
		merge(planConversation(agentId, new Date(now.getTime() - minutesAgo * MILLISECONDS_PER_MINUTE), MIN_TURNS, rng))
	}
	return rows
}

export async function seed(): Promise<void> {
	const [marker] = await sql`SELECT 1 FROM conversation WHERE id LIKE ${`${MARKER_PREFIX}%`} LIMIT 1`
	if (marker) {
		await refreshStaleRecentActivity()
		return
	}
	const rows = planRows(new Date())
	const chunkPromises: Promise<unknown>[] = []
	for (let index = 0; index < rows.conversations.length; index += INSERT_CHUNK_SIZE) {
		chunkPromises.push(db.insert(conversation).values(rows.conversations.slice(index, index + INSERT_CHUNK_SIZE)))
	}
	await Promise.all(chunkPromises)
	const attemptPromises: Promise<unknown>[] = []
	for (let index = 0; index < rows.attempts.length; index += INSERT_CHUNK_SIZE) {
		attemptPromises.push(db.insert(generationAttempt).values(rows.attempts.slice(index, index + INSERT_CHUNK_SIZE)))
	}
	await Promise.all(attemptPromises)
	const messagePromises: Promise<unknown>[] = []
	for (let index = 0; index < rows.messages.length; index += INSERT_CHUNK_SIZE) {
		messagePromises.push(db.insert(message).values(rows.messages.slice(index, index + INSERT_CHUNK_SIZE)))
	}
	await Promise.all(messagePromises)
	const usagePromises: Promise<unknown>[] = []
	for (let index = 0; index < rows.usages.length; index += INSERT_CHUNK_SIZE) {
		usagePromises.push(db.insert(usageRecord).values(rows.usages.slice(index, index + INSERT_CHUNK_SIZE)))
	}
	await Promise.all(usagePromises)
}

// Stale fixtures would freeze the active card at zero: shift the two newest marker conversations
// (planned last) back to now. Date math stays in SQL — the raw client returns timestamps as strings.
async function refreshStaleRecentActivity(): Promise<void> {
	const [fresh] = await sql`
		SELECT EXISTS (
			SELECT 1 FROM message m JOIN conversation c ON c.id = m.conversation_id
			WHERE c.id LIKE ${`${MARKER_PREFIX}%`} AND m.created_at > now() - ${ACTIVE_WINDOW_MINUTES} * interval '1 minute'
		) AS fresh
	`
	if (fresh?.fresh === true) return
	const stale = await sql`
		SELECT id FROM conversation
		WHERE id LIKE ${`${MARKER_PREFIX}%conversation`}
		ORDER BY CAST(split_part(id, '-', 3) AS integer) DESC
		LIMIT 2
	`
	const targetStart = new Date(Date.now() - ACTIVE_START_MINUTES_AGO * MILLISECONDS_PER_MINUTE).toISOString()
	// The child-table shifts are computed from the conversation's original created_at, so the
	// conversation rows themselves move only after those updates have landed.
	const childUpdates: Promise<unknown>[] = []
	const conversationUpdates: Promise<unknown>[] = []
	for (const row of stale) {
		if (typeof row?.id !== "string") continue
		childUpdates.push(
			sql`UPDATE message SET created_at = message.created_at + (${targetStart}::timestamptz - conversation.created_at), updated_at = message.updated_at + (${targetStart}::timestamptz - conversation.created_at) FROM conversation WHERE message.conversation_id = conversation.id AND conversation.id = ${row.id}`,
		)
		childUpdates.push(
			sql`UPDATE generation_attempt SET created_at = generation_attempt.created_at + (${targetStart}::timestamptz - conversation.created_at), updated_at = generation_attempt.updated_at + (${targetStart}::timestamptz - conversation.created_at), usage_recorded_at = generation_attempt.usage_recorded_at + (${targetStart}::timestamptz - conversation.created_at) FROM conversation WHERE generation_attempt.conversation_id = conversation.id AND conversation.id = ${row.id}`,
		)
		childUpdates.push(
			sql`UPDATE usage_record SET created_at = usage_record.created_at + (${targetStart}::timestamptz - conversation.created_at) FROM conversation WHERE usage_record.conversation_id = conversation.id AND conversation.id = ${row.id}`,
		)
		conversationUpdates.push(sql`UPDATE conversation SET created_at = ${targetStart}::timestamptz WHERE id = ${row.id}`)
	}
	await Promise.all(childUpdates)
	await Promise.all(conversationUpdates)
}
