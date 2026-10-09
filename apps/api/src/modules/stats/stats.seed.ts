import { db, sql } from "@/db/client.ts"
import { conversation, generationAttempt, message } from "@/modules/conversation/conversation.schema.ts"
import { usageRecord } from "@/modules/usage/usage.schema.ts"
import { estimateTokens } from "@/modules/usage/usage.service.ts"

// Development statistics fixtures: a month of fixed daily traffic per seeded agent plus two
// recent conversations, so the dashboard renders real series out of the box. Runs once; the
// marker prefix keeps later seeds off.
const DAYS = 30
const MARKER_PREFIX = "seed-stats-"
const MESSAGES_PER_TURN = 2
const TURNS_PER_CONVERSATION = 2
const MESSAGE_GAP_MS = 45_000
const MILLISECONDS_PER_MINUTE = 60_000
const MILLISECONDS_PER_DAY = 86_400_000
// Matches the API's active-conversation window so the recent fixtures count as active.
const ACTIVE_MINUTES_AGO = 12
const INPUT_TOKENS_PER_TURN = 640
const OUTPUT_TOKENS_PER_TURN = 160

const SEED_AGENTS = [
	{ agentId: "11111111-1111-4111-8111-111111111111", conversationsPerDay: 6 }, // Website Assistant
	{ agentId: "33333333-3333-4333-8333-333333333333", conversationsPerDay: 4 }, // Product Advisor
	{ agentId: "44444444-4444-4444-8444-444444444444", conversationsPerDay: 2 }, // Docs Assistant
] as const

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

type PlannedRowSets = {
	attempts: (typeof generationAttempt.$inferInsert)[]
	conversations: (typeof conversation.$inferInsert)[]
	messages: (typeof message.$inferInsert)[]
	usages: (typeof usageRecord.$inferInsert)[]
}

function planConversation(agentId: string, startedAt: Date): PlannedRowSets {
	const turns = TURNS_PER_CONVERSATION
	const conversationId = nextId("conversation")
	const attemptId = nextId("attempt")
	const base = startedAt.getTime()
	const inputTokens = turns * INPUT_TOKENS_PER_TURN
	const outputTokens = turns * OUTPUT_TOKENS_PER_TURN
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
	const conversationSpanMs = TURNS_PER_CONVERSATION * MESSAGES_PER_TURN * MESSAGE_GAP_MS
	for (const { agentId, conversationsPerDay } of SEED_AGENTS) {
		for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
			const dayStart = dayStartUtc(daysAgo)
			// Today's traffic only fills the elapsed part of the day.
			const daySpanMs = daysAgo === 0 ? Math.max(now.getTime() - dayStart.getTime(), 1) : MILLISECONDS_PER_DAY
			for (let index = 0; index < conversationsPerDay; index += 1) {
				const offset = Math.floor(((index + 1) * daySpanMs) / (conversationsPerDay + 1))
				const start = new Date(dayStart.getTime() + offset)
				// Early-morning seeds: skip starts that would run messages into the future.
				if (start.getTime() + conversationSpanMs > now.getTime()) continue
				merge(planConversation(agentId, start))
			}
		}
	}
	// Recent traffic so the live activity card shows figures right after seeding.
	for (const { agentId } of [SEED_AGENTS[0], SEED_AGENTS[1]]) {
		merge(planConversation(agentId, new Date(now.getTime() - ACTIVE_MINUTES_AGO * MILLISECONDS_PER_MINUTE)))
	}
	return rows
}

export async function seed(): Promise<void> {
	const [marker] = await sql`SELECT 1 FROM conversation WHERE id LIKE ${`${MARKER_PREFIX}%`} LIMIT 1`
	if (marker) return
	const rows = planRows(new Date())
	await db.insert(conversation).values(rows.conversations)
	await db.insert(generationAttempt).values(rows.attempts)
	await db.insert(message).values(rows.messages)
	await db.insert(usageRecord).values(rows.usages)
}
