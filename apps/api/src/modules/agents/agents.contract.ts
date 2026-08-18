import { z } from "zod"

export const agentResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	systemPrompt: z.string(),
	wordBlacklist: z.array(z.string()),
	status: z.enum(["active", "paused"]),
	avatarUrl: z.string().nullable(),
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
	id: z.string(),
	name: z.string(),
	mimeType: z.string(),
	sizeBytes: z.number().int().nonnegative(),
	createdAt: z.date(),
})

export const agentFilesResponseSchema = z.object({
	files: z.array(agentFileResponseSchema),
})

const MAX_FILE_NAME_LENGTH = 255

export const renameAgentFileRequestSchema = z.object({
	name: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
})
