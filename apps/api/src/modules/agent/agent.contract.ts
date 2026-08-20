import { z } from "zod"

import {
	AGENT_NAME_MAX_LENGTH,
	AGENT_STATUSES,
	BLACKLIST_MAX_WORDS,
	BLACKLIST_WORD_MAX_LENGTH,
	SYSTEM_PROMPT_MAX_LENGTH,
} from "./agent.service.ts"

const nameSchema = z.string().trim().min(1).max(AGENT_NAME_MAX_LENGTH)
const systemPromptSchema = z.string().max(SYSTEM_PROMPT_MAX_LENGTH)
const wordBlacklistSchema = z.array(z.string().trim().min(1).max(BLACKLIST_WORD_MAX_LENGTH)).max(BLACKLIST_MAX_WORDS)

const agentSchema = z.object({
	id: z.string(),
	name: z.string(),
	ownerId: z.string().nullable(),
	status: z.enum(AGENT_STATUSES),
	systemPrompt: z.string(),
	wordBlacklist: z.array(z.string()),
})

export const createAgentRequestSchema = z.object({
	name: nameSchema,
	systemPrompt: systemPromptSchema.optional(),
	status: z.enum(AGENT_STATUSES).optional(),
	wordBlacklist: wordBlacklistSchema.optional(),
})

export const updateAgentRequestSchema = z
	.object({
		name: nameSchema.optional(),
		systemPrompt: systemPromptSchema.optional(),
		status: z.enum(AGENT_STATUSES).optional(),
		wordBlacklist: wordBlacklistSchema.optional(),
	})
	.refine((patch) => Object.keys(patch).length > 0, { message: "Provide at least one field to update" })

export const agentResponseSchema = z.object({ agent: agentSchema })
export const agentListResponseSchema = z.object({ agents: z.array(agentSchema) })
