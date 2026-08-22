import {
	badRequestResponse,
	conflictResponse,
	forbiddenResponse,
	internalServerErrorResponse,
	noContentResponse,
	notFoundResponse,
	sessionSecurity,
	unauthorizedResponse,
} from "@/http/openapi.ts"
import { createRoute, z } from "@hono/zod-openapi"

import {
	AGENT_NAME_MAX_LENGTH,
	BLACKLIST_MAX_WORDS,
	BLACKLIST_WORD_MAX_LENGTH,
	SYSTEM_PROMPT_MAX_LENGTH,
} from "./agent.service.ts"

export const agentResponseSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		systemPrompt: z.string(),
		wordBlacklist: z.array(z.string()),
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
	})
	.openapi("Agent")

const agentInputSchema = z.object({
	name: z.string().min(1).max(AGENT_NAME_MAX_LENGTH),
	systemPrompt: z.string().min(1).max(SYSTEM_PROMPT_MAX_LENGTH),
	wordBlacklist: z.array(z.string().min(1).max(BLACKLIST_WORD_MAX_LENGTH)).max(BLACKLIST_MAX_WORDS),
})

export const createAgentRequestSchema = agentInputSchema
export const updateAgentRequestSchema = agentInputSchema

export const agentDetailResponseSchema = z.object({ agent: agentResponseSchema })
export const agentListResponseSchema = z.object({ agents: z.array(agentResponseSchema) })

const agentParamsSchema = z.object({
	agentId: z.string().openapi({ param: { name: "agentId", in: "path" } }),
})

export const listAgentsRoute = createRoute({
	method: "get",
	path: "/",
	operationId: "listAgents",
	tags: ["Agent"],
	security: sessionSecurity,
	responses: {
		200: { content: { "application/json": { schema: agentListResponseSchema } }, description: "All agents" },
		401: unauthorizedResponse,
		403: forbiddenResponse,
		500: internalServerErrorResponse,
	},
})

export const createAgentRoute = createRoute({
	method: "post",
	path: "/",
	operationId: "createAgent",
	tags: ["Agent"],
	security: sessionSecurity,
	request: {
		body: { content: { "application/json": { schema: createAgentRequestSchema } }, required: true },
	},
	responses: {
		201: { content: { "application/json": { schema: agentDetailResponseSchema } }, description: "Agent created" },
		400: badRequestResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		409: conflictResponse,
		500: internalServerErrorResponse,
	},
})

export const getAgentRoute = createRoute({
	method: "get",
	path: "/{agentId}",
	operationId: "getAgent",
	tags: ["Agent"],
	security: sessionSecurity,
	request: { params: agentParamsSchema },
	responses: {
		200: { content: { "application/json": { schema: agentDetailResponseSchema } }, description: "One agent" },
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		500: internalServerErrorResponse,
	},
})

export const updateAgentRoute = createRoute({
	method: "put",
	path: "/{agentId}",
	operationId: "updateAgent",
	tags: ["Agent"],
	security: sessionSecurity,
	request: {
		params: agentParamsSchema,
		body: { content: { "application/json": { schema: updateAgentRequestSchema } }, required: true },
	},
	responses: {
		200: { content: { "application/json": { schema: agentDetailResponseSchema } }, description: "Agent updated" },
		400: badRequestResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		409: conflictResponse,
		500: internalServerErrorResponse,
	},
})

export const deleteAgentRoute = createRoute({
	method: "delete",
	path: "/{agentId}",
	operationId: "deleteAgent",
	tags: ["Agent"],
	security: sessionSecurity,
	request: { params: agentParamsSchema },
	responses: {
		204: noContentResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		500: internalServerErrorResponse,
	},
})
