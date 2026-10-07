import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import type { McpCreateBody, McpUpdateBody } from "./mcp.contract.ts"

import {
	createMcpServerRoute,
	deleteMcpServerRoute,
	getMcpServerRoute,
	listMcpServersRoute,
	setMcpServerDisabledRoute,
	serverDetailSchema,
	serverListSchema,
	updateMcpServerRoute,
} from "./mcp.contract.ts"
import * as service from "./mcp.service.ts"

/**
 * Probe failure is a body field, not a status: a server in maintenance must not cost the operator their setup.
 * Only these are hard errors.
 */
function mapDomainError(error: unknown) {
	if (error instanceof service.McpServerNotFoundError)
		return { code: PROBLEM_CODES.MCP_SERVER_NOT_FOUND, status: HTTP_STATUS.NOT_FOUND } as const
	if (error instanceof service.UnknownAgentError)
		return { code: PROBLEM_CODES.AGENT_NOT_FOUND, status: HTTP_STATUS.NOT_FOUND } as const
	if (error instanceof service.DuplicateMcpServerNameError)
		return { code: PROBLEM_CODES.DUPLICATE_MCP_SERVER_NAME, status: HTTP_STATUS.CONFLICT } as const
	if (error instanceof service.RevisionConflictError)
		return { code: PROBLEM_CODES.CONFIGURATION_CONFLICT, status: HTTP_STATUS.CONFLICT } as const
	if (error instanceof service.InvalidMcpServerError)
		return { code: PROBLEM_CODES.INVALID_MCP_SERVER_URL, status: HTTP_STATUS.BAD_REQUEST } as const
	return null
}

export const mcpServerRoutes = new OpenAPIHono()
	.openapi(listMcpServersRoute, async (c) => {
		try {
			const servers = await service.listServers(c.req.valid("param").agentId)
			return c.json(serverListSchema.parse({ servers }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
	.openapi(createMcpServerRoute, async (c) => {
		try {
			const { agentId } = c.req.valid("param")
			const { name, server } = c.req.valid("json") as McpCreateBody
			const created = await service.createServer(agentId, { name, ...server })
			return c.json(serverDetailSchema.parse({ server: created }), HTTP_STATUS.CREATED)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
	.openapi(getMcpServerRoute, async (c) => {
		try {
			const { agentId, serverId } = c.req.valid("param")
			const server = await service.getServer(agentId, serverId)
			return c.json(serverDetailSchema.parse({ server }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
	.openapi(updateMcpServerRoute, async (c) => {
		try {
			const { agentId, serverId } = c.req.valid("param")
			const { name, server, expectedRevision, isDisabled, tools } = c.req.valid("json") as McpUpdateBody
			const updated = await service.updateServer(agentId, serverId, {
				name,
				...server,
				expectedRevision,
				isDisabled,
				tools,
			})
			return c.json(serverDetailSchema.parse({ server: updated }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
	.openapi(deleteMcpServerRoute, async (c) => {
		try {
			const { agentId, serverId } = c.req.valid("param")
			await service.deleteServer(agentId, serverId)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
	.openapi(setMcpServerDisabledRoute, async (c) => {
		try {
			const { agentId, serverId, action } = c.req.valid("param")
			const server = await service.setServerDisabled(agentId, serverId, action === "disable")
			return c.json(serverDetailSchema.parse({ server }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
