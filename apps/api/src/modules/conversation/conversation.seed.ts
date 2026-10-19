import { db, sql as postgres } from "@/db/client.ts"
import { estimateTokens } from "@/modules/usage/usage.service.ts"
import { sql } from "drizzle-orm"

import { conversation, type GenerationAttemptOutcome, generationAttempt, message } from "./conversation.schema.ts"

// Development traffic fixtures: a month of fixed daily conversations per seeded agent plus two
// recent ones, so dashboard statistics render real series out of the box. Returns the seeded
// attempts so the usage seed can meter them; empty when the marker says we already ran.
const DAYS = 30
const MARKER_PREFIX = "seed-stats-"
const MESSAGES_PER_TURN = 2
const TURNS_PER_CONVERSATION = 2
const MESSAGE_GAP_MS = 45_000
const MILLISECONDS_PER_MINUTE = 60_000
const MILLISECONDS_PER_DAY = 86_400_000
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

export type SeededAttempt = {
	generationAttemptId: string
	agentId: string
	conversationId: string
	inputTokens: number
	outputTokens: number
	createdAt: Date
}

type PlannedRows = {
	conversations: (typeof conversation.$inferInsert)[]
	attempts: (typeof generationAttempt.$inferInsert)[]
	messages: (typeof message.$inferInsert)[]
	usages: SeededAttempt[]
}

function planConversation(agentId: string, startedAt: Date): PlannedRows {
	const turns = TURNS_PER_CONVERSATION
	const conversationId = nextId("conversation")
	const attemptId = nextId("attempt")
	const base = startedAt.getTime()
	const inputTokens = turns * INPUT_TOKENS_PER_TURN
	const outputTokens = turns * OUTPUT_TOKENS_PER_TURN
	const messages: PlannedRows["messages"] = []
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

function planRows(now: Date): PlannedRows {
	const rows: PlannedRows = { attempts: [], conversations: [], messages: [], usages: [] }
	const merge = (planned: PlannedRows) => {
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
	for (const { agentId } of [SEED_AGENTS[0], SEED_AGENTS[1]]) {
		merge(planConversation(agentId, new Date(now.getTime() - ACTIVE_MINUTES_AGO * MILLISECONDS_PER_MINUTE)))
	}
	return rows
}

async function seedTraffic(): Promise<SeededAttempt[]> {
	const [marker] = await postgres`SELECT 1 FROM conversation WHERE id LIKE ${`${MARKER_PREFIX}%`} LIMIT 1`
	if (marker) return []
	const rows = planRows(new Date())
	await db.transaction(async (tx) => {
		await tx.insert(conversation).values(rows.conversations)
		await tx.insert(generationAttempt).values(rows.attempts)
		await tx.insert(message).values(rows.messages)
	})
	return rows.usages
}

const TRANSCRIPT_AGENT_ID = SEED_AGENTS[0].agentId
const TRANSCRIPT_EMBED_ID = "22222222-2222-4222-8222-222222222222"
const TRANSCRIPT_TOKENS = 200
const UUID_NODE_DIGITS = 12
const MILLISECONDS_PER_HOUR = 3_600_000

type TranscriptTurn = { answer: string; outcome: GenerationAttemptOutcome; question: string }
type TranscriptConversation = { startedHoursAgo: number; turns: TranscriptTurn[] }

// Every reply outcome the transcript view labels, plus the Markdown answers can contain.
const TRANSCRIPTS: TranscriptConversation[] = [
	{
		startedHoursAgo: 72,
		turns: [
			{
				question: "How long does shipping to Germany take?",
				answer:
					"Orders to Germany usually arrive in **3–5 business days**. You get a tracking link by email once it ships.",
				outcome: "completed",
			},
			{
				question: "Can I change the delivery address after ordering?",
				answer: "Yes, until the order ships. Reply to your confirmation email with the new address and we update it.",
				outcome: "completed",
			},
		],
	},
	{
		startedHoursAgo: 30,
		turns: [
			{
				question: "What plans do you offer?",
				answer:
					"We offer three plans:\n\n- **Starter**: one website, email support\n- **Growth**: up to five websites, priority support\n- **Business**: unlimited websites and a dedicated contact\n\nSee the [pricing page](https://example.com/pricing) for current prices.",
				outcome: "completed",
			},
		],
	},
	{
		startedHoursAgo: 26,
		turns: [
			{
				question: "How do I add the chat to my website?",
				answer:
					'Paste this snippet before the closing `</body>` tag:\n\n```html\n<script src="https://chat.example.com/widget.js" data-embed-token="YOUR_TOKEN" async></script>\n```\n\n| Platform | Where to paste |\n| --- | --- |\n| Shopify | Theme > Edit code > `theme.liquid` |\n| WordPress | Appearance > Theme file editor > `footer.php` |',
				outcome: "completed",
			},
		],
	},
	{
		startedHoursAgo: 20,
		turns: [
			{ question: "Do you integrate with Zendesk?", answer: "We do not integrate directly with", outcome: "blocked" },
		],
	},
	{
		startedHoursAgo: 5,
		turns: [{ question: "Is the product available in Czech?", answer: "", outcome: "failed" }],
	},
	{
		startedHoursAgo: 2,
		turns: [
			{
				question: "Can I return a sale item?",
				answer: "Sale items can be returned within",
				outcome: "interrupted",
			},
		],
	},
	{
		startedHoursAgo: 0.5,
		turns: [
			{
				question: "Write me a long comparison of every plan feature.",
				answer: "Here is a full comparison of every feature, starting with",
				outcome: "cancelled",
			},
		],
	},
]

/** Deterministic UUIDv4s, so re-seeding finds the same rows instead of duplicating them. */
function seedId(kind: string, index: number): string {
	return `${kind}-0000-4000-8000-${String(index).padStart(UUID_NODE_DIGITS, "0")}`
}

function transcriptRows(now: number) {
	let attemptCount = 0
	let messageCount = 0
	const conversations: (typeof conversation.$inferInsert)[] = []
	const attempts: (typeof generationAttempt.$inferInsert)[] = []
	const messages: (typeof message.$inferInsert)[] = []
	for (const [index, seeded] of TRANSCRIPTS.entries()) {
		const conversationId = seedId("66666666", index)
		const startedAt = now - seeded.startedHoursAgo * MILLISECONDS_PER_HOUR
		let latestCompletedMessageId: string | null = null
		let revision = 0
		for (const [turnIndex, turn] of seeded.turns.entries()) {
			const attemptId = seedId("88888888", (attemptCount += 1))
			const askedAt = new Date(startedAt + turnIndex * MILLISECONDS_PER_MINUTE)
			const questionId = seedId("99999999", (messageCount += 1))
			const answerId = seedId("99999999", (messageCount += 1))
			if (turn.outcome === "completed") {
				latestCompletedMessageId = answerId
				revision += 1
			}
			// Usage stays unrecorded: the usage module's recovery records it like any finished reply.
			attempts.push({
				id: attemptId,
				conversationId,
				requestId: seedId("aaaaaaaa", attemptCount),
				estimatedInputTokens: TRANSCRIPT_TOKENS,
				status: turn.outcome,
				finalOutcome: turn.outcome,
				networkHash: "seed-network",
				leaseToken: attemptId,
				leaseExpiresAt: askedAt,
				provider: "openai-compatible",
				model: "chat-model",
				providerInvoked: true,
				usageInputTokens: TRANSCRIPT_TOKENS,
				usageOutputTokens: TRANSCRIPT_TOKENS,
				createdAt: askedAt,
				updatedAt: askedAt,
			})
			messages.push(
				{
					id: questionId,
					conversationId,
					generationAttemptId: attemptId,
					role: "user",
					text: turn.question,
					outcome: "completed",
					createdAt: askedAt,
					updatedAt: askedAt,
				},
				{
					id: answerId,
					conversationId,
					generationAttemptId: attemptId,
					role: "assistant",
					text: turn.answer,
					outcome: turn.outcome,
					// Mirrors acceptance, which orders the reply 1 ms after the question.
					createdAt: new Date(askedAt.getTime() + 1),
					updatedAt: askedAt,
				},
			)
		}
		conversations.push({
			id: conversationId,
			referenceId: seedId("77777777", index),
			agentId: TRANSCRIPT_AGENT_ID,
			embedId: TRANSCRIPT_EMBED_ID,
			embedAccessVersion: 1,
			revision,
			latestCompletedMessageId,
			createdAt: new Date(startedAt),
		})
	}
	return { attempts, conversations, messages }
}

async function seedTranscripts(): Promise<void> {
	const rows = transcriptRows(Date.now())
	await db.transaction(async (tx) => {
		// Upserts keep fixture edits visible on re-seed; usage fields stay untouched so metering never repeats.
		await tx
			.insert(conversation)
			.values(rows.conversations)
			.onConflictDoUpdate({
				target: conversation.id,
				set: {
					revision: sql`excluded.revision`,
					latestCompletedMessageId: sql`excluded.latest_completed_message_id`,
					createdAt: sql`excluded.created_at`,
				},
			})
		await tx
			.insert(generationAttempt)
			.values(rows.attempts)
			.onConflictDoUpdate({
				target: generationAttempt.id,
				set: {
					status: sql`excluded.status`,
					finalOutcome: sql`excluded.final_outcome`,
					createdAt: sql`excluded.created_at`,
					updatedAt: sql`excluded.updated_at`,
				},
			})
		await tx
			.insert(message)
			.values(rows.messages)
			.onConflictDoUpdate({
				target: message.id,
				set: {
					text: sql`excluded.text`,
					outcome: sql`excluded.outcome`,
					createdAt: sql`excluded.created_at`,
					updatedAt: sql`excluded.updated_at`,
				},
			})
	})
}

export async function seed(): Promise<SeededAttempt[]> {
	await seedTranscripts()
	return seedTraffic()
}
