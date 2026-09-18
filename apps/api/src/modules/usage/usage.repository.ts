import { db } from "@/db/client.ts"
import { eq } from "drizzle-orm"

import { usageRecord } from "./usage.schema.ts"

export type UsageRecord = typeof usageRecord.$inferInsert
class UsageConflictError extends Error {}

export async function recordUsage(value: UsageRecord): Promise<void> {
	const inserted = await db
		.insert(usageRecord)
		.values(value)
		.onConflictDoNothing({ target: usageRecord.generationAttemptId })
		.returning({ generationAttemptId: usageRecord.generationAttemptId })
	if (inserted.length === 1) return
	const [existing] = await db
		.select()
		.from(usageRecord)
		.where(eq(usageRecord.generationAttemptId, value.generationAttemptId))
		.limit(1)
	if (
		!existing ||
		existing.agentId !== value.agentId ||
		existing.conversationId !== value.conversationId ||
		existing.provider !== value.provider ||
		existing.model !== value.model ||
		existing.outcome !== value.outcome ||
		existing.inputTokens !== value.inputTokens ||
		existing.outputTokens !== value.outputTokens
	) {
		throw new UsageConflictError("Generation attempt usage conflicts with its persisted finalization")
	}
}
