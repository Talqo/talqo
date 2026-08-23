import { db } from "@/db/client.ts"
import { eq, sql } from "drizzle-orm"

import { agent, blacklistWord } from "./agent.schema.ts"

export type AgentRow = typeof agent.$inferSelect
export type NewAgent = typeof agent.$inferInsert
export type BlacklistWordRow = typeof blacklistWord.$inferSelect

export type AgentWithWords = {
	agent: AgentRow
	words: BlacklistWordRow[]
}

// Postgres now() is identical within a transaction, so stagger timestamps to keep word order.
function wordRows(agentId: string, words: string[]): (typeof blacklistWord.$inferInsert)[] {
	const base = Date.now()
	return words.map((word, position) => ({
		id: crypto.randomUUID(),
		agentId,
		word,
		createdAt: new Date(base + position),
	}))
}

async function attachWords(rows: AgentRow[]): Promise<AgentWithWords[]> {
	return Promise.all(
		rows.map(async (row) => ({
			agent: row,
			words: await db
				.select()
				.from(blacklistWord)
				.where(eq(blacklistWord.agentId, row.id))
				.orderBy(blacklistWord.createdAt, blacklistWord.id),
		})),
	)
}

export async function findAllWithWords(): Promise<AgentWithWords[]> {
	const rows = await db
		.select()
		.from(agent)
		.orderBy(sql`lower(${agent.name})`)
	return attachWords(rows)
}

export async function findByIdWithWords(id: string): Promise<AgentWithWords | undefined> {
	const [row] = await db.select().from(agent).where(eq(agent.id, id)).limit(1)
	if (!row) return undefined
	return (await attachWords([row]))[0]
}

// Insert agent and words atomically; a word failure must not leave a bare agent.
export async function insertWithWords(values: NewAgent, words: string[]): Promise<AgentWithWords> {
	const row = await db.transaction(async (tx) => {
		const [inserted] = await tx.insert(agent).values(values).returning()
		if (!inserted) throw new Error("insertWithWords: insert returned no row")
		if (words.length > 0) {
			await tx.insert(blacklistWord).values(wordRows(inserted.id, words))
		}
		return inserted
	})
	const found = await findByIdWithWords(row.id)
	if (!found) throw new Error("insertWithWords: could not read back inserted agent")
	return found
}

export async function updateWithWords(
	id: string,
	values: Pick<NewAgent, "name" | "systemPrompt">,
	words: string[],
): Promise<AgentWithWords | undefined> {
	return db.transaction(async (tx) => {
		const [updated] = await tx
			.update(agent)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(agent.id, id))
			.returning()
		if (!updated) return undefined
		await tx.delete(blacklistWord).where(eq(blacklistWord.agentId, id))
		if (words.length > 0) {
			await tx.insert(blacklistWord).values(wordRows(id, words))
		}
		const wordsOut = await tx
			.select()
			.from(blacklistWord)
			.where(eq(blacklistWord.agentId, id))
			.orderBy(blacklistWord.createdAt, blacklistWord.id)
		return { agent: updated, words: wordsOut }
	})
}

export async function updateEmbedToken(id: string, embedToken: string): Promise<AgentWithWords | undefined> {
	const [updated] = await db.update(agent).set({ embedToken }).where(eq(agent.id, id)).returning({ id: agent.id })
	if (!updated) return undefined
	return findByIdWithWords(id)
}

export async function deleteById(id: string): Promise<boolean> {
	const rows = await db.delete(agent).where(eq(agent.id, id)).returning({ id: agent.id })
	return rows.length > 0
}
