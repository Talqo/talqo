import { access } from "@/http/access.ts"
import { noContentResponse, payloadTooLargeResponse, problemResponse } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import * as roles from "@/modules/roles/roles.service.ts"
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
	authMode: z.enum(["none", "headers"]),
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
	/** Removals are explicit names: values stay masked, so omission means preserve. */
	server: z.discriminatedUnion("transport", [
		httpServerSchema.extend({
			deleteHeaders: z.array(z.string().min(1).max(SECRET_NAME_MAX_LENGTH)).max(MAX_SECRET_ENTRIES).optional(),
		}),
		stdioServerSchema.extend({
			deleteEnv: z.array(z.string().min(1).max(SECRET_NAME_MAX_LENGTH)).max(MAX_SECRET_ENTRIES).optional(),
		}),
	]),
	expectedRevision: z.number().int().nonnegative(),
	isDisabled: z.boolean().optional(),
	/** Sends names and flags. The schema and description come from the last probe. */
	tools: z.array(z.strictObject({ name: z.string(), selected: z.boolean() })).optional(),
})

const serverResponseSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		transport: z.enum(["http", "stdio"]),
		url: z.string().nullable(),
		authMode: z.enum(["none", "headers"]).nullable(),
		command: z.string().nullable(),
		args: z.array(z.string()),
		headers: z.array(secretNameSchema),
		env: z.array(secretNameSchema),
		tools: z.array(toolSnapshotSchema),
		toolCount: z.number().int().nonnegative(),
		isWorking: z.boolean(),
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

const authRequired = problemResponse([PROBLEM_CODES.AUTHENTICATION_REQUIRED])
const forbidden = problemResponse([PROBLEM_CODES.PERMISSION_DENIED])
const notFound = problemResponse([PROBLEM_CODES.AGENT_NOT_FOUND, PROBLEM_CODES.MCP_SERVER_NOT_FOUND])
const serverError = problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR])
const domain = {
	400: problemResponse([
		PROBLEM_CODES.INVALID_REQUEST,
		PROBLEM_CODES.MALFORMED_JSON,
		PROBLEM_CODES.INVALID_MCP_SERVER_URL,
	]),
	401: authRequired,
	403: forbidden,
	404: notFound,
	409: problemResponse([PROBLEM_CODES.DUPLICATE_MCP_SERVER_NAME, PROBLEM_CODES.CONFIGURATION_CONFLICT]),
	500: serverError,
}

export const listMcpServersRoute = createRoute({
	...access.permission(roles.Permission.AgentsRead),
	method: "get",
	path: "/{agentId}/mcp-servers",
	operationId: "listMcpServers",
	tags: ["MCP"],
	request: { params: agentParamsSchema },
	responses: {
		200: { content: { "application/json": { schema: serverListSchema } }, description: "Connections listed" },
		...domain,
	},
})

export const createMcpServerRoute = createRoute({
	...access.permission(roles.Permission.AgentsManage),
	method: "post",
	path: "/{agentId}/mcp-servers",
	operationId: "createMcpServer",
	tags: ["MCP"],
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
	...access.permission(roles.Permission.AgentsRead),
	method: "get",
	path: "/{agentId}/mcp-servers/{serverId}",
	operationId: "getMcpServer",
	tags: ["MCP"],
	request: { params: serverParamsSchema },
	responses: {
		200: { content: { "application/json": { schema: serverDetailSchema } }, description: "Connection read" },
		...domain,
	},
})

export const updateMcpServerRoute = createRoute({
	...access.permission(roles.Permission.AgentsManage),
	method: "put",
	path: "/{agentId}/mcp-servers/{serverId}",
	operationId: "updateMcpServer",
	tags: ["MCP"],
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
	...access.permission(roles.Permission.AgentsManage),
	method: "delete",
	path: "/{agentId}/mcp-servers/{serverId}",
	operationId: "deleteMcpServer",
	tags: ["MCP"],
	request: { params: serverParamsSchema },
	responses: {
		204: noContentResponse,
		...domain,
	},
})

// Dedicated enable/disable, mirroring embed: PUT carries the whole configuration, so flipping a
// boolean through it would mean re-sending secrets the operator never sees.
export const setMcpServerDisabledRoute = createRoute({
	...access.permission(roles.Permission.AgentsManage),
	method: "post",
	path: "/{agentId}/mcp-servers/{serverId}/{action}",
	operationId: "setMcpServerDisabled",
	tags: ["MCP"],
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

export type McpCreateBody = z.infer<typeof createRequestSchema>
export type McpUpdateBody = z.infer<typeof updateRequestSchema>
