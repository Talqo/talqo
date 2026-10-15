import { HTTP_STATUS } from "@/http/status.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import {
	agentDetailResponseSchema,
	agentListResponseSchema,
	createAgentRoute,
	deleteAgentRoute,
	getAgentRoute,
	listAgentsRoute,
	updateAgentRoute,
} from "./agent.contract.ts"
import * as service from "./agent.service.ts"

// Contract schemas serialize timestamps as ISO strings.
function serialize(agent: service.Agent) {
	return { ...agent, createdAt: agent.createdAt.toISOString(), updatedAt: agent.updatedAt.toISOString() }
}

export const agentRoutes = new OpenAPIHono()
	.openapi(listAgentsRoute, async (c) => {
		return c.json(
			agentListResponseSchema.parse({ agents: (await service.listAgents()).map(serialize) }),
			HTTP_STATUS.OK,
		)
	})
	.openapi(createAgentRoute, async (c) => {
		const agent = await service.createAgent(c.req.valid("json"))
		return c.json(agentDetailResponseSchema.parse({ agent: serialize(agent) }), HTTP_STATUS.CREATED)
	})
	.openapi(getAgentRoute, async (c) => {
		const agent = await service.getAgent(c.req.valid("param").agentId)
		return c.json(agentDetailResponseSchema.parse({ agent: serialize(agent) }), HTTP_STATUS.OK)
	})
	.openapi(updateAgentRoute, async (c) => {
		const agent = await service.updateAgent(c.req.valid("param").agentId, c.req.valid("json"))
		return c.json(agentDetailResponseSchema.parse({ agent: serialize(agent) }), HTTP_STATUS.OK)
	})
	.openapi(deleteAgentRoute, async (c) => {
		await service.deleteAgent(c.req.valid("param").agentId)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
