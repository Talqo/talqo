import { db } from "@/db/client.ts"
import { eq } from "drizzle-orm"

import { conversationUsage } from "./usage.schema.ts"

export type UsageRecord = typeof conversationUsage.$inferInsert
export class UsageConflictError extends Error {}

export async function recordUsage(value: UsageRecord): Promise<void> {
	const inserted = await db
		.insert(conversationUsage)
		.values(value)
		.onConflictDoNothing({ target: conversationUsage.attemptId })
		.returning({ attemptId: conversationUsage.attemptId })
	if (inserted.length === 1) return
	const [existing] = await db
		.select()
		.from(conversationUsage)
		.where(eq(conversationUsage.attemptId, value.attemptId))
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
		throw new UsageConflictError("Attempt usage conflicts with its persisted finalization")
	}
}
