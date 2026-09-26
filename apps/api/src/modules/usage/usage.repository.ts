import { db } from "@/db/client.ts"
import { and, eq, gte, sql } from "drizzle-orm"

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

export type DailyUsageTotals = {
	date: string
	inputTokens: number
	outputTokens: number
}

const usageDay = sql<string>`to_char(${usageRecord.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
const usageInputTokens = sql<number>`coalesce(sum(${usageRecord.inputTokens}), 0)::int`
const usageOutputTokens = sql<number>`coalesce(sum(${usageRecord.outputTokens}), 0)::int`

export async function getDailyUsageTotals(since: Date, agentId?: string): Promise<DailyUsageTotals[]> {
	return db
		.select({ date: usageDay, inputTokens: usageInputTokens, outputTokens: usageOutputTokens })
		.from(usageRecord)
		.where(and(gte(usageRecord.createdAt, since), agentId ? eq(usageRecord.agentId, agentId) : undefined))
		.groupBy(usageDay)
		.orderBy(usageDay)
}

export async function getUsageTotalsByAgent(
	since: Date,
): Promise<{ agentId: string; inputTokens: number; outputTokens: number }[]> {
	return db
		.select({ agentId: usageRecord.agentId, inputTokens: usageInputTokens, outputTokens: usageOutputTokens })
		.from(usageRecord)
		.where(gte(usageRecord.createdAt, since))
		.groupBy(usageRecord.agentId)
}
