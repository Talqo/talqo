import { isForeignKeyViolation } from "@/lib/pg-error.ts"

import * as repo from "./agent.repository.ts"

export const AGENT_NAME_MAX_LENGTH = 80
export const SYSTEM_PROMPT_MAX_LENGTH = 8000
export const BLACKLIST_WORD_MAX_LENGTH = 64
export const BLACKLIST_MAX_WORDS = 500

export const AGENT_STATUSES = ["active", "paused"] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

export type Agent = {
	id: string
	name: string
	ownerId: string | null
	status: AgentStatus
	systemPrompt: string
	wordBlacklist: string[]
}

export class AgentNotFoundError extends Error {}
export class AgentInUseError extends Error {}

type AgentRow = Awaited<ReturnType<typeof repo.findAgent>>

function toAgent(row: NonNullable<AgentRow>, wordBlacklist: string[]): Agent {
	return {
		id: row.id,
		name: row.name,
		ownerId: row.ownerId,
		status: row.status,
		systemPrompt: row.systemPrompt,
		wordBlacklist,
	}
}

/** Trims, drops blanks, and deduplicates case-sensitively to match the unique index. */
export function normalizeBlacklist(words: string[]): string[] {
	return [...new Set(words.map((word) => word.trim()).filter((word) => word.length > 0))]
}

export async function listAgents(): Promise<Agent[]> {
	const rows = await repo.listAgents()
	const lists = await Promise.all(rows.map((row) => repo.findWords(row.id)))
	return rows.map((row, index) => toAgent(row, lists[index] ?? []))
}

export async function getAgent(id: string): Promise<Agent> {
	const row = await repo.findAgent(id)
	if (!row) throw new AgentNotFoundError(`Agent ${id} not found`)
	return toAgent(row, await repo.findWords(id))
}

export async function createAgent(input: {
	name: string
	ownerId: string
	status?: AgentStatus
	systemPrompt?: string
	wordBlacklist?: string[]
}): Promise<Agent> {
	const row = await repo.insertAgent({
		id: crypto.randomUUID(),
		ownerId: input.ownerId,
		name: input.name,
		systemPrompt: input.systemPrompt ?? "",
		status: input.status ?? "active",
	})
	const words = normalizeBlacklist(input.wordBlacklist ?? [])
	if (words.length > 0) {
		await repo.replaceWords(row.id, words)
	}
	return toAgent(row, words)
}

export async function updateAgent(
	id: string,
	patch: { name?: string; status?: AgentStatus; systemPrompt?: string; wordBlacklist?: string[] },
): Promise<Agent> {
	const { wordBlacklist, ...columns } = patch
	// An empty patch must still confirm the agent exists rather than silently succeeding.
	const row = Object.keys(columns).length > 0 ? await repo.updateAgent(id, columns) : await repo.findAgent(id)
	if (!row) throw new AgentNotFoundError(`Agent ${id} not found`)

	if (wordBlacklist) {
		await repo.replaceWords(id, normalizeBlacklist(wordBlacklist))
	}
	return toAgent(row, await repo.findWords(id))
}

export async function deleteAgent(id: string): Promise<void> {
	const row = await repo.findAgent(id)
	if (!row) throw new AgentNotFoundError(`Agent ${id} not found`)

	try {
		await repo.deleteAgent(id)
	} catch (error) {
		// `widget.agent_id` is ON DELETE RESTRICT: widgets already embedded on customer
		// sites must be reassigned or removed first rather than breaking silently.
		if (isForeignKeyViolation(error)) {
			throw new AgentInUseError("Agent still serves one or more widgets")
		}
		throw error
	}
}

export async function agentExists(id: string): Promise<boolean> {
	return (await repo.findAgent(id)) !== undefined
}
