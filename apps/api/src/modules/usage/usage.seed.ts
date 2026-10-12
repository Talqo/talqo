import { db } from "@/db/client.ts"

import { usageRecord } from "./usage.schema.ts"

import type { SeededAttempt } from "@/modules/conversation/conversation.seed.ts"

	generationAttemptId: string
	agentId: string
	conversationId: string
	inputTokens: number
	outputTokens: number
	createdAt: Date
}

// Meters the attempts the conversation seed planted; empty input means the fixtures already ran.
export async function seed(attempts: SeededAttemptUsage[]): Promise<void> {
	if (attempts.length === 0) return
	await db.insert(usageRecord).values(
		attempts.map((attempt) => ({
			...attempt,
			provider: "seed",
			model: "chat-model",
			outcome: "completed" as const,
		})),
	)
}
