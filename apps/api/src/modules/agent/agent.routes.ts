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

function mapDomainError(error: unknown) {
	if (error instanceof service.InvalidAgentInputError) {
		return { code: PROBLEM_CODES.AGENT_INVALID, status: HTTP_STATUS.BAD_REQUEST }
	}
	if (error instanceof service.AgentNotFoundError) {
		return { code: PROBLEM_CODES.AGENT_NOT_FOUND, status: HTTP_STATUS.NOT_FOUND }
	}
	if (error instanceof service.DuplicateAgentNameError) {
		return { code: PROBLEM_CODES.AGENT_NAME_TAKEN, status: HTTP_STATUS.CONFLICT }
	}
	return null
}

// Contract schemas serialize timestamps as ISO strings.
function serialize(agent: service.Agent) {
	return { ...agent, createdAt: agent.createdAt.toISOString(), updatedAt: agent.updatedAt.toISOString() }
}

export const agentRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(listAgentsRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:read"))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}
		return c.json(
			agentListResponseSchema.parse({ agents: (await service.listAgents()).map(serialize) }),
			HTTP_STATUS.OK,
		)
	})
	.openapi(createAgentRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const agent = await service.createAgent(c.req.valid("json"))
			return c.json(agentDetailResponseSchema.parse({ agent: serialize(agent) }), HTTP_STATUS.CREATED)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status as never)
			throw error
		}
	})
	.openapi(getAgentRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:read"))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const agent = await service.getAgent(c.req.valid("param").agentId)
			return c.json(agentDetailResponseSchema.parse({ agent: serialize(agent) }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status as never)
			throw error
		}
	})
	.openapi(updateAgentRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const agent = await service.updateAgent(c.req.valid("param").agentId, c.req.valid("json"))
			return c.json(agentDetailResponseSchema.parse({ agent: serialize(agent) }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status as never)
			throw error
		}
	})
	.openapi(refreshEmbedTokenRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const agent = await service.refreshEmbedToken(c.req.valid("param").agentId)
			return c.json(agentDetailResponseSchema.parse({ agent: serialize(agent) }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status as never)
			throw error
		}
	})
	.openapi(deleteAgentRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			await service.deleteAgent(c.req.valid("param").agentId)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status as never)
			throw error
		}
	})
