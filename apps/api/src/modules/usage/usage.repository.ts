import { db } from "@/db/client.ts"

import { conversationUsage } from "./usage.schema.ts"

export type UsageRecord = typeof conversationUsage.$inferInsert

export async function recordUsage(value: UsageRecord): Promise<void> {
	await db.insert(conversationUsage).values(value).onConflictDoNothing({ target: conversationUsage.attemptId })
}

export async function reset(): Promise<void> {
	await db.delete(conversationUsage)
}
