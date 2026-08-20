import { env } from "@/config/env.ts"
import { z } from "zod"

export const agentResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	systemPrompt: z.string(),
	wordBlacklist: z.array(z.string()),
	status: z.enum(["active", "paused"]),
})

export const agentsResponseSchema = z.object({
	agents: z.array(agentResponseSchema),
})

export const createAgentRequestSchema = z.object({
	name: z.string().min(1),
})

export const updateAgentRequestSchema = z
	.object({
		name: z.string().min(1),
		systemPrompt: z.string(),
		wordBlacklist: z.array(z.string()),
		active: z.boolean(),
	})
	.partial()

export const agentFileResponseSchema = z.object({
	// The name doubles as the id: files are unique per agent directory and have no database row.
	name: z.string(),
	sizeBytes: z.number().int().nonnegative(),
	createdAt: z.date(),
})

export const agentFilesResponseSchema = z.object({
	files: z.array(agentFileResponseSchema),
	maxSizeBytes: z.number().int().positive(),
	maxNameLength: z.number().int().positive(),
})

export const renameAgentFileRequestSchema = z.object({
	name: z.string().min(1).max(env.TALQO_MAX_FILE_NAME_LENGTH),
})
