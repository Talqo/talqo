import { db } from "@/db/client.ts"
import { asc, eq, sql } from "drizzle-orm"

import { embed } from "./embed.schema.ts"

export type Embed = typeof embed.$inferSelect
export type NewEmbed = typeof embed.$inferInsert
export type EmbedPatch = Omit<NewEmbed, "accessVersion" | "createdAt" | "embedToken" | "id">

export async function listEmbeds(agentId?: string): Promise<Embed[]> {
	const query = db.select().from(embed)
	return agentId
		? query.where(eq(embed.agentId, agentId)).orderBy(asc(embed.createdAt))
		: query.orderBy(asc(embed.createdAt))
}

export async function findEmbed(id: string): Promise<Embed | undefined> {
	const [row] = await db.select().from(embed).where(eq(embed.id, id)).limit(1)
	return row
}

export async function findEmbedByToken(embedToken: string): Promise<Embed | undefined> {
	const [row] = await db.select().from(embed).where(eq(embed.embedToken, embedToken)).limit(1)
	return row
}

export async function insertEmbed(values: NewEmbed): Promise<Embed> {
	const [row] = await db.insert(embed).values(values).returning()
	if (!row) throw new Error("insertEmbed: insert returned no row")
	return row
}

export async function updateEmbed(id: string, patch: EmbedPatch): Promise<Embed | undefined> {
	const [row] = await db
		.update(embed)
		.set({
			...patch,
			accessVersion: sql`${embed.accessVersion} + CASE WHEN ${embed.agentId} <> ${patch.agentId} THEN 1 ELSE 0 END`,
			updatedAt: new Date(),
		})
		.where(eq(embed.id, id))
		.returning()
	return row
}

export async function rotateEmbedToken(id: string, embedToken: string): Promise<Embed | undefined> {
	const [row] = await db
		.update(embed)
		.set({ embedToken, accessVersion: sql`${embed.accessVersion} + 1`, updatedAt: new Date() })
		.where(eq(embed.id, id))
		.returning()
	return row
}

/** Seed-only: lets the deterministic E2E fixture embed a known token. */
export async function setEmbedToken(id: string, embedToken: string): Promise<void> {
	await db.update(embed).set({ embedToken, updatedAt: new Date() }).where(eq(embed.id, id))
}

export async function deleteEmbed(id: string): Promise<void> {
	await db.delete(embed).where(eq(embed.id, id))
}
