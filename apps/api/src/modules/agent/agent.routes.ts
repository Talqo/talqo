import type { AuthedVariables } from "@/http/require-auth.ts"

import { parseJsonBody } from "@/http/json-body.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { Hono } from "hono"
import { z } from "zod"

import {
	agentListResponseSchema,
	agentResponseSchema,
	createAgentRequestSchema,
	updateAgentRequestSchema,
} from "./agent.contract.ts"
import * as service from "./agent.service.ts"

export const agentRoutes = new Hono<{ Variables: AuthedVariables }>()
	.get("/api/agents", async (c) => {
		return c.json(agentListResponseSchema.parse({ agents: await service.listAgents() }))
	})
	.post("/api/agents", async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:write"))) {
			return c.json({ error: "Missing agents:write permission" }, HTTP_STATUS.FORBIDDEN)
		}

		const body = createAgentRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		const agent = await service.createAgent({ ...body.data, ownerId: user.id })
		return c.json(agentResponseSchema.parse({ agent }), HTTP_STATUS.CREATED)
	})
	.get("/api/agents/:id", async (c) => {
		try {
			return c.json(agentResponseSchema.parse({ agent: await service.getAgent(c.req.param("id")) }))
		} catch (error) {
			if (error instanceof service.AgentNotFoundError) {
				return c.json({ error: "Agent not found" }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.patch("/api/agents/:id", async (c) => {
		const user = c.get("user")
		const id = c.req.param("id")
		if (!(await roles.authorize(user.id, "agents:write", id))) {
			return c.json({ error: "Missing agents:write permission" }, HTTP_STATUS.FORBIDDEN)
		}

		const body = updateAgentRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			return c.json(agentResponseSchema.parse({ agent: await service.updateAgent(id, body.data) }))
		} catch (error) {
			if (error instanceof service.AgentNotFoundError) {
				return c.json({ error: "Agent not found" }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.delete("/api/agents/:id", async (c) => {
		const user = c.get("user")
		const id = c.req.param("id")
		if (!(await roles.authorize(user.id, "agents:write", id))) {
			return c.json({ error: "Missing agents:write permission" }, HTTP_STATUS.FORBIDDEN)
		}

		try {
			await service.deleteAgent(id)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			if (error instanceof service.AgentNotFoundError) {
				return c.json({ error: "Agent not found" }, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof service.AgentInUseError) {
				return c.json({ error: error.message }, HTTP_STATUS.CONFLICT)
			}
			throw error
		}
	})
