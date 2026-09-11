import type { AuthedVariables } from "@/http/require-auth.ts"

import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import {
	agentDetailResponseSchema,
	agentListResponseSchema,
	createAgentRoute,
	deleteAgentRoute,
	getAgentRoute,
	listAgentsRoute,
	refreshEmbedTokenRoute,
	updateAgentRoute,
} from "./agent.contract.ts"
import * as service from "./agent.service.ts"

// Contract schemas serialize timestamps as ISO strings.
function serialize(agent: service.Agent) {
	return { ...agent, createdAt: agent.createdAt.toISOString(), updatedAt: agent.updatedAt.toISOString() }
}

export const agentRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(listAgentsRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsRead))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}
		return c.json(
			agentListResponseSchema.parse({ agents: (await service.listAgents()).map(serialize) }),
			HTTP_STATUS.OK,
		)
	})
	.openapi(createAgentRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsManage))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const agent = await service.createAgent(c.req.valid("json"))
			return c.json(agentDetailResponseSchema.parse({ agent: serialize(agent) }), HTTP_STATUS.CREATED)
		} catch (error) {
			if (error instanceof service.InvalidAgentInputError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_INVALID, HTTP_STATUS.BAD_REQUEST)
			}
			if (error instanceof service.DuplicateAgentNameError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_NAME_TAKEN, HTTP_STATUS.CONFLICT)
			}
			throw error
		}
	})
	.openapi(getAgentRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsRead))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const agent = await service.getAgent(c.req.valid("param").agentId)
			return c.json(agentDetailResponseSchema.parse({ agent: serialize(agent) }), HTTP_STATUS.OK)
		} catch (error) {
			if (error instanceof service.AgentNotFoundError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.openapi(updateAgentRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsManage))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const agent = await service.updateAgent(c.req.valid("param").agentId, c.req.valid("json"))
			return c.json(agentDetailResponseSchema.parse({ agent: serialize(agent) }), HTTP_STATUS.OK)
		} catch (error) {
			if (error instanceof service.InvalidAgentInputError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_INVALID, HTTP_STATUS.BAD_REQUEST)
			}
			if (error instanceof service.AgentNotFoundError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof service.DuplicateAgentNameError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_NAME_TAKEN, HTTP_STATUS.CONFLICT)
			}
			throw error
		}
	})
	.openapi(refreshEmbedTokenRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsManage))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const agent = await service.refreshEmbedToken(c.req.valid("param").agentId)
			return c.json(agentDetailResponseSchema.parse({ agent: serialize(agent) }), HTTP_STATUS.OK)
		} catch (error) {
			if (error instanceof service.AgentNotFoundError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.openapi(deleteAgentRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsManage))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			await service.deleteAgent(c.req.valid("param").agentId)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			if (error instanceof service.AgentNotFoundError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof service.AgentInUseError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_IN_USE, HTTP_STATUS.CONFLICT)
			}
			throw error
		}
	})
