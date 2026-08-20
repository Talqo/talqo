import { db } from "@/db/client.ts"
import { asc, eq } from "drizzle-orm"

import { agent, blacklistWord } from "./agent.schema.ts"

export type Agent = typeof agent.$inferSelect
export type NewAgent = typeof agent.$inferInsert
export type AgentPatch = Partial<Omit<NewAgent, "id" | "createdAt">>

export async function listAgents(): Promise<Agent[]> {
	return db.select().from(agent).orderBy(asc(agent.createdAt))
}

export async function findAgent(id: string): Promise<Agent | undefined> {
	const [row] = await db.select().from(agent).where(eq(agent.id, id)).limit(1)
	return row
}

export async function insertAgent(values: NewAgent): Promise<Agent> {
	const [row] = await db.insert(agent).values(values).returning()
	if (!row) throw new Error("insertAgent: insert returned no row")
	return row
}

export async function updateAgent(id: string, patch: AgentPatch): Promise<Agent | undefined> {
	const [row] = await db
		.update(agent)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(agent.id, id))
		.returning()
	return row
}

export async function deleteAgent(id: string): Promise<void> {
	await db.delete(agent).where(eq(agent.id, id))
}

export async function findWords(agentId: string): Promise<string[]> {
	const rows = await db
		.select({ word: blacklistWord.word })
		.from(blacklistWord)
		.where(eq(blacklistWord.agentId, agentId))
		.orderBy(asc(blacklistWord.word))
	return rows.map((row) => row.word)
}

/** Replaces the whole list in one transaction so a partial write can't half-apply. */
export async function replaceWords(agentId: string, words: string[]): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.delete(blacklistWord).where(eq(blacklistWord.agentId, agentId))
		if (words.length > 0) {
			await tx.insert(blacklistWord).values(words.map((word) => ({ id: crypto.randomUUID(), agentId, word })))
		}
	})
}
