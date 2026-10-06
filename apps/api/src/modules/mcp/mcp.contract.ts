import { noContentResponse, payloadTooLargeResponse, problemResponse, sessionSecurity } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import { createRoute, z } from "@hono/zod-openapi"

import { MCP_SERVER_NAME_MAX_LENGTH } from "./mcp.types.ts"

const SECRET_NAME_MAX_LENGTH = 256
const SECRET_VALUE_MAX_LENGTH = 4_096
const MAX_SECRET_ENTRIES = 50
const MAX_ARGS = 50
const ARG_MAX_LENGTH = 1_000
const COMMAND_MAX_LENGTH = 512

const secretRecordSchema = z
	.record(z.string().min(1).max(SECRET_NAME_MAX_LENGTH), z.string().min(1).max(SECRET_VALUE_MAX_LENGTH))
	.refine((record) => Object.keys(record).length <= MAX_SECRET_ENTRIES, {
		message: `At most ${MAX_SECRET_ENTRIES} entries are allowed`,
	})

const serverNameSchema = z.string().trim().min(1).max(MCP_SERVER_NAME_MAX_LENGTH)
const toolSnapshotSchema = z.object({
	name: z.string(),
	description: z.string(),
	selected: z.boolean(),
})

const secretNameSchema = z.object({ name: z.string(), hasValue: z.boolean() })

const httpServerSchema = z.strictObject({
	transport: z.literal("http"),
	url: z.url(),
	authMode: z.enum(["none", "headers", "oauth"]),
	headers: secretRecordSchema.optional(),
})

const stdioServerSchema = z.strictObject({
	transport: z.literal("stdio"),
	command: z.string().trim().min(1).max(COMMAND_MAX_LENGTH),
	args: z.array(z.string().max(ARG_MAX_LENGTH)).max(MAX_ARGS).optional(),
	env: secretRecordSchema.optional(),
})

const mcpServerInputSchema = z.discriminatedUnion("transport", [httpServerSchema, stdioServerSchema])

const createRequestSchema = z.strictObject({ name: serverNameSchema, server: mcpServerInputSchema })

const updateRequestSchema = z.strictObject({
	name: serverNameSchema,
	server: mcpServerInputSchema,
	expectedRevision: z.number().int().nonnegative(),
	isDisabled: z.boolean().optional(),
	/** Names and flags only: the schema and description come from the last probe. */
	tools: z.array(z.strictObject({ name: z.string(), selected: z.boolean() })).optional(),
})

const serverResponseSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		transport: z.enum(["http", "stdio"]),
		url: z.string().nullable(),
		authMode: z.enum(["none", "headers", "oauth"]).nullable(),
		command: z.string().nullable(),
		args: z.array(z.string()),
		headers: z.array(secretNameSchema),
		env: z.array(secretNameSchema),
		tools: z.array(toolSnapshotSchema),
		toolCount: z.number().int().nonnegative(),
		health: z.enum(["unconfigured", "healthy", "unhealthy"]),
		healthDetail: z.string().nullable(),
		isDisabled: z.boolean(),
		revision: z.number().int().nonnegative(),
	})
	.openapi("McpServer")

export const serverDetailSchema = z.object({ server: serverResponseSchema })
export const serverListSchema = z.object({ servers: z.array(serverResponseSchema) })

const agentParamsSchema = z.object({
	agentId: z.string().openapi({ param: { name: "agentId", in: "path" } }),
})
const serverParamsSchema = z.object({
	agentId: z.string().openapi({ param: { name: "agentId", in: "path" } }),
	serverId: z.string().openapi({ param: { name: "serverId", in: "path" } }),
})
const callbackQuerySchema = z.object({
	code: z.string().optional(),
	state: z.string().optional(),
	error: z.string().optional(),
})

const authRequired = problemResponse([PROBLEM_CODES.AUTHENTICATION_REQUIRED])
const forbidden = problemResponse([PROBLEM_CODES.PERMISSION_DENIED])
const notFound = problemResponse([PROBLEM_CODES.AGENT_NOT_FOUND, PROBLEM_CODES.MCP_SERVER_NOT_FOUND])
const serverError = problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR])
/** Every route maps the same domain errors, so every route declares the same set. */
const domain = {
	400: problemResponse([
		PROBLEM_CODES.INVALID_REQUEST,
		PROBLEM_CODES.MALFORMED_JSON,
		PROBLEM_CODES.INVALID_MCP_SERVER_URL,
		PROBLEM_CODES.MCP_AUTHORIZATION_SERVER_CHANGED,
	]),
	401: authRequired,
	403: forbidden,
	404: notFound,
	409: problemResponse([PROBLEM_CODES.DUPLICATE_MCP_SERVER_NAME, PROBLEM_CODES.CONFIGURATION_CONFLICT]),
	500: serverError,
}

export const listMcpServersRoute = createRoute({
	method: "get",
	path: "/{agentId}/mcp-servers",
	operationId: "listMcpServers",
	tags: ["MCP"],
	security: sessionSecurity,
	request: { params: agentParamsSchema },
	responses: {
		200: { content: { "application/json": { schema: serverListSchema } }, description: "Connections listed" },
		...domain,
	},
})

export const createMcpServerRoute = createRoute({
	method: "post",
	path: "/{agentId}/mcp-servers",
	operationId: "createMcpServer",
	tags: ["MCP"],
	security: sessionSecurity,
	request: {
		params: agentParamsSchema,
		body: { required: true, content: { "application/json": { schema: createRequestSchema } } },
	},
	responses: {
		201: { content: { "application/json": { schema: serverDetailSchema } }, description: "Connection created" },
		...domain,
		413: payloadTooLargeResponse,
	},
})

export const getMcpServerRoute = createRoute({
	method: "get",
	path: "/{agentId}/mcp-servers/{serverId}",
	operationId: "getMcpServer",
	tags: ["MCP"],
	security: sessionSecurity,
	request: { params: serverParamsSchema },
	responses: {
		200: { content: { "application/json": { schema: serverDetailSchema } }, description: "Connection read" },
		...domain,
	},
})

export const updateMcpServerRoute = createRoute({
	method: "put",
	path: "/{agentId}/mcp-servers/{serverId}",
	operationId: "updateMcpServer",
	tags: ["MCP"],
	security: sessionSecurity,
	request: {
		params: serverParamsSchema,
		body: { required: true, content: { "application/json": { schema: updateRequestSchema } } },
	},
	responses: {
		200: { content: { "application/json": { schema: serverDetailSchema } }, description: "Connection updated" },
		...domain,
		413: payloadTooLargeResponse,
	},
})

export const deleteMcpServerRoute = createRoute({
	method: "delete",
	path: "/{agentId}/mcp-servers/{serverId}",
	operationId: "deleteMcpServer",
	tags: ["MCP"],
	security: sessionSecurity,
	request: { params: serverParamsSchema },
	responses: {
		204: noContentResponse,
		...domain,
	},
})

// Dedicated enable/disable, mirroring embed: PUT carries the whole configuration, so flipping a
// boolean through it would mean re-sending secrets the operator never sees.
export const setMcpServerDisabledRoute = createRoute({
	method: "post",
	path: "/{agentId}/mcp-servers/{serverId}/{action}",
	operationId: "setMcpServerDisabled",
	tags: ["MCP"],
	security: sessionSecurity,
	request: {
		params: z.object({
			agentId: z.string().openapi({ param: { name: "agentId", in: "path" } }),
			serverId: z.string().openapi({ param: { name: "serverId", in: "path" } }),
			action: z.enum(["enable", "disable"]),
		}),
	},
	responses: {
		200: { content: { "application/json": { schema: serverDetailSchema } }, description: "Connection updated" },
		...domain,
	},
})

export const probeMcpServerRoute = createRoute({
	method: "post",
	path: "/{agentId}/mcp-servers/{serverId}/probe",
	operationId: "probeMcpServer",
	tags: ["MCP"],
	security: sessionSecurity,
	request: { params: serverParamsSchema },
	responses: {
		200: { content: { "application/json": { schema: serverDetailSchema } }, description: "Connection tested" },
		...domain,
		502: problemResponse([PROBLEM_CODES.MCP_SERVER_UNREACHABLE]),
	},
})

export const authorizeMcpServerRoute = createRoute({
	method: "post",
	path: "/{agentId}/mcp-servers/{serverId}/oauth/authorize",
	operationId: "authorizeMcpServer",
	tags: ["MCP"],
	security: sessionSecurity,
	request: { params: serverParamsSchema },
	responses: {
		200: {
			content: { "application/json": { schema: z.object({ authorizationUrl: z.string().nullable() }) } },
			description: "Sign-in URL, or null when no sign-in is needed",
		},
		...domain,
	},
})

export const mcpCallbackRoute = createRoute({
	method: "get",
	path: "/{agentId}/mcp-servers/{serverId}/oauth/callback",
	operationId: "completeMcpServerAuthorization",
	tags: ["MCP"],
	security: sessionSecurity,
	request: { params: serverParamsSchema, query: callbackQuerySchema },
	responses: {
		302: { description: "Redirects back to the agent page" },
		...domain,
	},
})

export type McpCreateBody = z.infer<typeof createRequestSchema>
export type McpUpdateBody = z.infer<typeof updateRequestSchema>
