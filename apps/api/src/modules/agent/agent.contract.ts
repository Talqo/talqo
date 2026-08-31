import { noContentResponse, problemResponse, sessionSecurity } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
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
		embedToken: z.uuid(),
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

const malformedJson = problemResponse([PROBLEM_CODES.MALFORMED_JSON])
const invalidAgent = problemResponse([
	PROBLEM_CODES.AGENT_INVALID,
	PROBLEM_CODES.INVALID_REQUEST,
	PROBLEM_CODES.MALFORMED_JSON,
])
const authRequired = problemResponse([PROBLEM_CODES.AUTHENTICATION_REQUIRED])
const forbidden = problemResponse([PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED, PROBLEM_CODES.PERMISSION_DENIED])
const agentNotFound = problemResponse([PROBLEM_CODES.AGENT_NOT_FOUND])
const serverError = problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR])

export const listAgentsRoute = createRoute({
	method: "get",
	path: "/",
	operationId: "listAgents",
	tags: ["Agent"],
	security: sessionSecurity,
	responses: {
		200: { content: { "application/json": { schema: agentListResponseSchema } }, description: "All agents" },
		400: malformedJson,
		401: authRequired,
		403: forbidden,
		500: serverError,
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
		400: invalidAgent,
		401: authRequired,
		403: forbidden,
		409: problemResponse([PROBLEM_CODES.AGENT_NAME_TAKEN]),
		500: serverError,
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
		400: malformedJson,
		401: authRequired,
		403: forbidden,
		404: agentNotFound,
		500: serverError,
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
		400: invalidAgent,
		401: authRequired,
		403: forbidden,
		404: agentNotFound,
		409: problemResponse([PROBLEM_CODES.AGENT_NAME_TAKEN]),
		500: serverError,
	},
})

export const refreshEmbedTokenRoute = createRoute({
	method: "post",
	path: "/{agentId}/embed-token/refresh",
	operationId: "refreshEmbedToken",
	tags: ["Agent"],
	security: sessionSecurity,
	request: { params: agentParamsSchema },
	responses: {
		200: {
			content: { "application/json": { schema: agentDetailResponseSchema } },
			description: "Embed token rotated; the old value is orphaned",
		},
		400: malformedJson,
		401: authRequired,
		403: forbidden,
		404: agentNotFound,
		500: serverError,
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
		400: malformedJson,
		401: authRequired,
		403: forbidden,
		404: agentNotFound,
		500: serverError,
	},
})
