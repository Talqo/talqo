import { db } from "@/db/client.ts"
import { and, asc, eq, inArray, sql } from "drizzle-orm"

import { embed } from "./embed.schema.ts"

export type Embed = typeof embed.$inferSelect
export type NewEmbed = typeof embed.$inferInsert
export type EmbedPatch = Omit<NewEmbed, "accessVersion" | "createdAt" | "embedToken" | "id">

export async function listEmbeds(scope: readonly string[] | "all"): Promise<Embed[]> {
	return db
		.select()
		.from(embed)
		.where(scope === "all" ? undefined : inArray(embed.agentId, [...scope]))
		.orderBy(asc(embed.createdAt))
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

export async function updateEmbed(id: string, patch: EmbedPatch, sourceAgentId: string): Promise<Embed | undefined> {
	const [row] = await db
		.update(embed)
		.set({
			...patch,
			accessVersion: sql`${embed.accessVersion} + CASE WHEN ${embed.agentId} <> ${patch.agentId} THEN 1 ELSE 0 END`,
			updatedAt: new Date(),
		})
		.where(and(eq(embed.id, id), eq(embed.agentId, sourceAgentId)))
		.returning()
	return row
}

export async function rotateEmbedToken(
	id: string,
	embedToken: string,
	sourceAgentId: string,
): Promise<Embed | undefined> {
	const [row] = await db
		.update(embed)
		.set({ embedToken, accessVersion: sql`${embed.accessVersion} + 1`, updatedAt: new Date() })
		.where(and(eq(embed.id, id), eq(embed.agentId, sourceAgentId)))
		.returning()
	return row
}

// No accessVersion bump: disabling must not silently kill live sessions (the flag is
// enforced at acceptance instead). `updatedAt` still moves so the public config ETag flips.
export async function setEmbedDisabled(
	id: string,
	isDisabled: boolean,
	sourceAgentId: string,
): Promise<Embed | undefined> {
	const [row] = await db
		.update(embed)
		.set({ isDisabled, updatedAt: new Date() })
		.where(and(eq(embed.id, id), eq(embed.agentId, sourceAgentId)))
		.returning()
	return row
}

export async function deleteEmbed(id: string, sourceAgentId: string): Promise<boolean> {
	const removed = await db
		.delete(embed)
		.where(and(eq(embed.id, id), eq(embed.agentId, sourceAgentId)))
		.returning({ id: embed.id })
	return removed.length > 0
}
