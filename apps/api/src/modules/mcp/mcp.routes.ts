import { env } from "@/config/env.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { annotate, annotator } from "@/http/wide-event.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import {
	createMcpServerRoute,
	deleteMcpServerRoute,
	getMcpServerRoute,
	listMcpServersRoute,
	serverDetailSchema,
	serverListSchema,
	setMcpServerDisabledRoute,
	updateMcpServerRoute,
} from "./mcp.contract.ts"
import * as service from "./mcp.service.ts"

/**
 * Probe failure is a body field, not a status. Only these are hard errors.
 */
const serversRoutes = new OpenAPIHono()
	.openapi(listMcpServersRoute, async (c) => {
		const servers = await service.listServers(c.req.valid("param").agentId)
		return c.json(serverListSchema.parse({ servers, stdioAllowed: env.TALQO_MCP_ALLOW_STDIO }), HTTP_STATUS.OK)
	})
	.openapi(createMcpServerRoute, async (c) => {
		const { agentId } = c.req.valid("param")
		const { name, server } = c.req.valid("json")
		annotate(c, { "mcp.transport": server.transport })
		const created = await service.createServer(agentId, { name, ...server }, annotator(c))
		annotate(c, { "mcp.server.id": created.id })
		return c.json(serverDetailSchema.parse({ server: created }), HTTP_STATUS.CREATED)
	})
	.openapi(getMcpServerRoute, async (c) => {
		const { agentId, serverId } = c.req.valid("param")
		const server = await service.getServer(agentId, serverId)
		return c.json(serverDetailSchema.parse({ server }), HTTP_STATUS.OK)
	})
	.openapi(updateMcpServerRoute, async (c) => {
		const { agentId, serverId } = c.req.valid("param")
		const { name, server, expectedRevision, tools } = c.req.valid("json")
		annotate(c, { "mcp.transport": server.transport })
		const updated = await service.updateServer(
			agentId,
			serverId,
			{ name, ...server, expectedRevision, tools },
			annotator(c),
		)
		return c.json(serverDetailSchema.parse({ server: updated }), HTTP_STATUS.OK)
	})
	.openapi(deleteMcpServerRoute, async (c) => {
		const { agentId, serverId } = c.req.valid("param")
		await service.deleteServer(agentId, serverId)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
	.openapi(setMcpServerDisabledRoute, async (c) => {
		const { agentId, serverId, action } = c.req.valid("param")
		const server = await service.setServerDisabled(agentId, serverId, action === "disable")
		return c.json(serverDetailSchema.parse({ server }), HTTP_STATUS.OK)
	})

const routes = new OpenAPIHono()
routes.route("/:agentId/mcp-servers", serversRoutes)

export const mcpServerRoutes = routes
