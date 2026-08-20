import { db } from "@/db/client.ts"
import { and, eq } from "drizzle-orm"

import { agent } from "./agents.schema.ts"

export type Agent = typeof agent.$inferSelect
export type NewAgent = typeof agent.$inferInsert

export async function insertAgent(values: NewAgent): Promise<Agent> {
	const [row] = await db.insert(agent).values(values).returning()
	if (!row) throw new Error("insertAgent: insert returned no row")
	return row
}

export async function listAgentsByOwner(ownerId: string): Promise<Agent[]> {
	return db.select().from(agent).where(eq(agent.ownerId, ownerId))
}

export async function findAgentByIdAndOwner(id: string, ownerId: string): Promise<Agent | undefined> {
	const [row] = await db
		.select()
		.from(agent)
		.where(and(eq(agent.id, id), eq(agent.ownerId, ownerId)))
	return row
}

export async function updateAgent(
	id: string,
	ownerId: string,
	values: Partial<Pick<NewAgent, "active" | "name" | "systemPrompt" | "wordBlacklist">>,
): Promise<Agent | undefined> {
	const [row] = await db
		.update(agent)
		.set({ ...values, updatedAt: new Date() })
		.where(and(eq(agent.id, id), eq(agent.ownerId, ownerId)))
		.returning()
	return row
}

export async function deleteAgent(id: string, ownerId: string): Promise<void> {
	await db.delete(agent).where(and(eq(agent.id, id), eq(agent.ownerId, ownerId)))
}
