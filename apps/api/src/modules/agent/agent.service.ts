export const AGENT_NAME_MAX_LENGTH = 100
export const SYSTEM_PROMPT_MAX_LENGTH = 20_000
export const BLACKLIST_WORD_MAX_LENGTH = 100
export const BLACKLIST_MAX_WORDS = 100

import { ApiError, PROBLEM_CODES } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { isRestrictViolation, isUniqueViolation } from "@/lib/pg-error.ts"
import * as knowledgeBase from "@/modules/knowledge-base/knowledge-base.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"

import { PLATFORM_SYSTEM_PROMPT } from "./agent.platform-prompt.ts"
import * as repo from "./agent.repository.ts"

export class InvalidAgentInputError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.AGENT_INVALID, HTTP_STATUS.BAD_REQUEST, message, undefined, options)
	}
}
export class AgentNotFoundError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.AGENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND, message, undefined, options)
	}
}
class DuplicateAgentNameError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.AGENT_NAME_TAKEN, HTTP_STATUS.CONFLICT, message, undefined, options)
	}
}
export class AgentInUseError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.AGENT_IN_USE, HTTP_STATUS.CONFLICT, message, undefined, options)
	}
}

function toAgent({ agent, words }: repo.AgentWithWords): Agent {
	return {
		id: agent.id,
		name: agent.name,
		systemPrompt: agent.systemPrompt,
		wordBlacklist: words.map((word) => word.word),
		createdAt: agent.createdAt,
		updatedAt: agent.updatedAt,
	}
}

export type Agent = {
	createdAt: Date
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

export function composeSystemPrompt(systemPrompt: string): string {
	return `${PLATFORM_SYSTEM_PROMPT}\n${systemPrompt}`
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

export async function listAgents(
	actorId: string,
): Promise<(Pick<Agent, "id" | "name" | "createdAt" | "updatedAt"> & { permissions: roles.AgentPermission[] })[]> {
	const access = await roles.agentPermissionsById(actorId)
	const agents = await repo.findAll(access === "all" ? "all" : [...access.keys()])
	return agents.map(({ id, name, createdAt, updatedAt }) => ({
		id,
		name,
		createdAt,
		updatedAt,
		permissions: access === "all" ? [...roles.AGENT_PERMISSIONS] : (access.get(id) ?? []),
	}))
}

export async function listAgentsForRole(
	actorId: string,
	roleId: string,
): Promise<
	{
		id: string
		name: string
		permissions: roles.AgentPermission[]
		rolePermissions: roles.AgentPermission[]
	}[]
> {
	const [agents, roleGrants] = await Promise.all([listAgents(actorId), roles.listAgentGrantsOfRole(roleId)])
	const grants = Map.groupBy(roleGrants, ({ agentId }) => agentId)
	return agents
		.filter(({ permissions }) => permissions.includes(roles.AgentPermission.AgentRead))
		.map(({ id, name, permissions }) => ({
			id,
			name,
			permissions,
			rolePermissions: roles.AGENT_PERMISSIONS.filter((permission) =>
				grants.get(id)?.some((grant) => grant.permission === permission),
			),
		}))
}

// TODO(audit): record create/update/delete in AUDIT_LOG once the audit module exists.

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

export async function deleteAgent(id: string): Promise<void> {
	try {
		if (!(await repo.deleteById(id))) {
			throw new AgentNotFoundError(`deleteAgent: agent ${id} not found`)
		}
	} catch (error) {
		// `embed.agent_id` is ON DELETE RESTRICT: attached embeds must be deleted first.
		if (isRestrictViolation(error)) {
			throw new AgentInUseError("Agent still serves one or more embeds")
		}
		throw error
	}
	// Best-effort: the DB delete already committed, so never fail the delete.
	await knowledgeBase.removeAgentDir(id).catch((error: unknown) => console.error(error))
}
