import { db } from "@/db/client.ts"
import { asc, eq } from "drizzle-orm"

import { widget } from "./widget.schema.ts"

export type Widget = typeof widget.$inferSelect
export type NewWidget = typeof widget.$inferInsert
export type WidgetPatch = Partial<Omit<NewWidget, "id" | "publicToken" | "createdAt">>

export async function listWidgets(agentId?: string): Promise<Widget[]> {
	const query = db.select().from(widget)
	return agentId
		? query.where(eq(widget.agentId, agentId)).orderBy(asc(widget.createdAt))
		: query.orderBy(asc(widget.createdAt))
}

export async function findWidget(id: string): Promise<Widget | undefined> {
	const [row] = await db.select().from(widget).where(eq(widget.id, id)).limit(1)
	return row
}

export async function findWidgetByToken(publicToken: string): Promise<Widget | undefined> {
	const [row] = await db.select().from(widget).where(eq(widget.publicToken, publicToken)).limit(1)
	return row
}

export async function insertWidget(values: NewWidget): Promise<Widget> {
	const [row] = await db.insert(widget).values(values).returning()
	if (!row) throw new Error("insertWidget: insert returned no row")
	return row
}

export async function updateWidget(id: string, patch: WidgetPatch): Promise<Widget | undefined> {
	const [row] = await db
		.update(widget)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(widget.id, id))
		.returning()
	return row
}

/** Seed-only: lets the deterministic E2E fixture embed a known token. */
export async function setPublicToken(id: string, publicToken: string): Promise<void> {
	await db.update(widget).set({ publicToken, updatedAt: new Date() }).where(eq(widget.id, id))
}

export async function deleteWidget(id: string): Promise<void> {
	await db.delete(widget).where(eq(widget.id, id))
}
