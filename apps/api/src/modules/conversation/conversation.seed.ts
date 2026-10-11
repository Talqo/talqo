import { db } from "@/db/client.ts"

import { conversation, type GenerationAttemptOutcome, generationAttempt, message } from "./conversation.schema.ts"

const SEED_AGENT_ID = "11111111-1111-4111-8111-111111111111"
const SEED_EMBED_ID = "22222222-2222-4222-8222-222222222222"
const SEED_NETWORK_HASH = "seed-network"
const SEED_TOKENS = 200
const UUID_NODE_DIGITS = 12
const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

type SeedTurn = { answer: string; outcome: GenerationAttemptOutcome; question: string }
type SeedConversation = { startedHoursAgo: number; turns: SeedTurn[] }

// One conversation per outcome an operator should recognize in the transcript view.
const CONVERSATIONS: SeedConversation[] = [
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

function seedRows(now: number) {
	let attemptCount = 0
	let messageCount = 0
	const conversations: (typeof conversation.$inferInsert)[] = []
	const attempts: (typeof generationAttempt.$inferInsert)[] = []
	const messages: (typeof message.$inferInsert)[] = []
	for (const [index, seeded] of CONVERSATIONS.entries()) {
		const conversationId = seedId("66666666", index)
		const startedAt = now - seeded.startedHoursAgo * HOUR_MS
		let latestCompletedMessageId: string | null = null
		let revision = 0
		for (const [turnIndex, turn] of seeded.turns.entries()) {
			const attemptId = seedId("88888888", (attemptCount += 1))
			const askedAt = new Date(startedAt + turnIndex * MINUTE_MS)
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
				estimatedInputTokens: SEED_TOKENS,
				status: turn.outcome,
				finalOutcome: turn.outcome,
				networkHash: SEED_NETWORK_HASH,
				leaseToken: attemptId,
				leaseExpiresAt: askedAt,
				provider: "openai-compatible",
				model: "chat-model",
				providerInvoked: true,
				usageInputTokens: SEED_TOKENS,
				usageOutputTokens: SEED_TOKENS,
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
			agentId: SEED_AGENT_ID,
			embedId: SEED_EMBED_ID,
			embedAccessVersion: 1,
			revision,
			latestCompletedMessageId,
			createdAt: new Date(startedAt),
		})
	}
	return { attempts, conversations, messages }
}

export async function seed(): Promise<void> {
	const rows = seedRows(Date.now())
	await db.transaction(async (tx) => {
		await tx.insert(conversation).values(rows.conversations).onConflictDoNothing()
		await tx.insert(generationAttempt).values(rows.attempts).onConflictDoNothing()
		await tx.insert(message).values(rows.messages).onConflictDoNothing()
	})
}
