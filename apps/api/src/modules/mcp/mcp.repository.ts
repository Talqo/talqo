import { db } from "@/db/client.ts"
import { and, asc, eq } from "drizzle-orm"

import type { McpServerRow, NewMcpServer } from "./mcp.schema.ts"

import { mcpServer } from "./mcp.schema.ts"

export type { McpServerRow }

export async function listForAgent(agentId: string): Promise<McpServerRow[]> {
	return db.select().from(mcpServer).where(eq(mcpServer.agentId, agentId)).orderBy(asc(mcpServer.createdAt))
}

export async function find(id: string): Promise<McpServerRow | undefined> {
	const [row] = await db.select().from(mcpServer).where(eq(mcpServer.id, id)).limit(1)
	return row
}

export async function insert(values: NewMcpServer): Promise<McpServerRow> {
	const [row] = await db.insert(mcpServer).values(values).returning()
	if (!row) throw new Error("insert: insert returned no row")
	return row
}

export async function update(id: string, patch: Partial<McpServerRow>): Promise<McpServerRow | undefined> {
	const [row] = await db
		.update(mcpServer)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(mcpServer.id, id))
		.returning()
	return row
}

/** Operator edits are the only writes that bump `revision`; probes and token refreshes must not. */
export async function updateAtRevision(
	id: string,
	patch: Partial<McpServerRow>,
	expectedRevision: number,
): Promise<McpServerRow | undefined> {
	const [row] = await db
		.update(mcpServer)
		.set({ ...patch, revision: expectedRevision + 1, updatedAt: new Date() })
		.where(and(eq(mcpServer.id, id), eq(mcpServer.revision, expectedRevision)))
		.returning()
	return row
}

export async function remove(id: string): Promise<void> {
	await db.delete(mcpServer).where(eq(mcpServer.id, id))
}
