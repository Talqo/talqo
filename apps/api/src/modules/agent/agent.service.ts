export const AGENT_NAME_MAX_LENGTH = 100
export const SYSTEM_PROMPT_MAX_LENGTH = 20_000
export const BLACKLIST_WORD_MAX_LENGTH = 100
export const BLACKLIST_MAX_WORDS = 100

import { isUniqueViolation } from "@/lib/pg-error.ts"

import * as repo from "./agent.repository.ts"

export class InvalidAgentInputError extends Error {}
export class AgentNotFoundError extends Error {}
export class DuplicateAgentNameError extends Error {}

function toAgent({ agent, words }: repo.AgentWithWords): Agent {
	return {
		id: agent.id,
		name: agent.name,
		systemPrompt: agent.systemPrompt,
		embedToken: agent.embedToken,
		wordBlacklist: words.map((word) => word.word),
		createdAt: agent.createdAt,
		updatedAt: agent.updatedAt,
	}
}

export type Agent = {
	createdAt: Date
	embedToken: string
	id: string
	name: string
	systemPrompt: string
	updatedAt: Date
	wordBlacklist: string[]
}

export type AgentInput = {
	name: string
	systemPrompt: string
	wordBlacklist: string[]
}

export function normalizeAgentInput(input: AgentInput): AgentInput {
	const name = input.name.trim()
	if (name.length === 0) throw new InvalidAgentInputError("Agent name is required")
	if (name.length > AGENT_NAME_MAX_LENGTH) {
		throw new InvalidAgentInputError(`Agent name must be at most ${AGENT_NAME_MAX_LENGTH} characters`)
	}

	const systemPrompt = input.systemPrompt.trim()
	if (systemPrompt.length === 0) throw new InvalidAgentInputError("System prompt is required")
	if (systemPrompt.length > SYSTEM_PROMPT_MAX_LENGTH) {
		throw new InvalidAgentInputError(`System prompt must be at most ${SYSTEM_PROMPT_MAX_LENGTH} characters`)
	}

	const wordBlacklist: string[] = []
	const seen = new Set<string>()
	for (const raw of input.wordBlacklist) {
		const word = raw.trim()
		if (!word) continue
		if (word.length > BLACKLIST_WORD_MAX_LENGTH) {
			throw new InvalidAgentInputError(`Blacklist words must be at most ${BLACKLIST_WORD_MAX_LENGTH} characters`)
		}
		const key = word.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		wordBlacklist.push(word)
	}
	if (wordBlacklist.length > BLACKLIST_MAX_WORDS) {
		throw new InvalidAgentInputError(`An agent may define at most ${BLACKLIST_MAX_WORDS} blacklist words`)
	}

	return { name, systemPrompt, wordBlacklist }
}

export async function listAgents(): Promise<Agent[]> {
	return (await repo.findAllWithWords()).map(toAgent)
}

// TODO(conversation): systemPrompt composition + direct-match blacklist enforcement live
// with send-message orchestration (FR-1.1, NFR-2.2).
// TODO(audit): record create/update/delete in AUDIT_LOG once the audit module exists.
// TODO(conversation): rate-limit storage + IP/message limits belong to the conversation
// public boundary (NFR-3.5, NFR-3.6).

export async function getAgent(id: string): Promise<Agent> {
	const row = await repo.findByIdWithWords(id)
	if (!row) throw new AgentNotFoundError(`getAgent: agent ${id} not found`)
	return toAgent(row)
}

export async function createAgent(input: AgentInput): Promise<Agent> {
	const value = normalizeAgentInput(input)
	try {
		return toAgent(
			await repo.insertWithWords(
				{
					id: crypto.randomUUID(),
					name: value.name,
					systemPrompt: value.systemPrompt,
				},
				value.wordBlacklist,
			),
		)
	} catch (error) {
		if (isUniqueViolation(error)) throw new DuplicateAgentNameError("An agent with this name already exists")
		throw error
	}
}

export async function updateAgent(id: string, input: AgentInput): Promise<Agent> {
	const value = normalizeAgentInput(input)
	try {
		const updated = await repo.updateWithWords(
			id,
			{ name: value.name, systemPrompt: value.systemPrompt },
			value.wordBlacklist,
		)
		if (!updated) throw new AgentNotFoundError(`updateAgent: agent ${id} not found`)
		return toAgent(updated)
	} catch (error) {
		if (isUniqueViolation(error)) throw new DuplicateAgentNameError("An agent with this name already exists")
		throw error
	}
}

export async function refreshEmbedToken(id: string): Promise<Agent> {
	const updated = await repo.updateEmbedToken(id, crypto.randomUUID())
	if (!updated) throw new AgentNotFoundError(`refreshEmbedToken: agent ${id} not found`)
	return toAgent(updated)
}

export async function deleteAgent(id: string): Promise<void> {
	if (!(await repo.deleteById(id))) {
		throw new AgentNotFoundError(`deleteAgent: agent ${id} not found`)
	}
}
