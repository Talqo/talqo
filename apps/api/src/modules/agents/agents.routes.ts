import type { AuthedVariables } from "@/http/require-auth.ts"

import { parseJsonBody } from "@/http/json-body.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { isUniqueViolation } from "@/lib/pg-error.ts"
import { Hono } from "hono"
import { z } from "zod"

import {
	agentFileResponseSchema,
	agentFilesResponseSchema,
	agentResponseSchema,
	agentsResponseSchema,
	createAgentRequestSchema,
	renameAgentFileRequestSchema,
	updateAgentRequestSchema,
} from "./agents.contract.ts"
import * as service from "./agents.service.ts"

export const agentsRoutes = new Hono<{ Variables: AuthedVariables }>()
	.get("/api/agents", async (c) => {
		const agents = await service.listAgents(c.get("user").id)
		return c.json(agentsResponseSchema.parse({ agents }))
	})
	.post("/api/agents", async (c) => {
		const body = createAgentRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			const agent = await service.createAgent(c.get("user").id, body.data)
			return c.json({ agent: agentResponseSchema.parse(agent) }, HTTP_STATUS.CREATED)
		} catch (error) {
			if (isUniqueViolation(error)) return c.json({ error: "Agent name already in use" }, HTTP_STATUS.CONFLICT)
			throw error
		}
	})
	.get("/api/agents/:id", async (c) => {
		try {
			const agent = await service.getAgent(c.req.param("id"), c.get("user").id)
			return c.json({ agent: agentResponseSchema.parse(agent) })
		} catch (error) {
			if (error instanceof service.AgentNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.patch("/api/agents/:id", async (c) => {
		const body = updateAgentRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			const agent = await service.updateAgent(c.req.param("id"), c.get("user").id, body.data)
			return c.json({ agent: agentResponseSchema.parse(agent) })
		} catch (error) {
			if (error instanceof service.AgentNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			if (isUniqueViolation(error)) return c.json({ error: "Agent name already in use" }, HTTP_STATUS.CONFLICT)
			throw error
		}
	})
	.delete("/api/agents/:id", async (c) => {
		try {
			await service.deleteAgent(c.req.param("id"), c.get("user").id)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			if (error instanceof service.AgentNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.get("/api/agents/:id/files", async (c) => {
		try {
			const files = await service.listFiles(c.req.param("id"), c.get("user").id)
			return c.json(agentFilesResponseSchema.parse({ files }))
		} catch (error) {
			if (error instanceof service.AgentNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.post("/api/agents/:id/files", async (c) => {
		const body = await c.req.parseBody()
		const file = body["file"]
		if (!(file instanceof File)) {
			return c.json({ error: "Multipart field 'file' is required" }, HTTP_STATUS.BAD_REQUEST)
		}

		try {
			const uploaded = await service.uploadFile(c.req.param("id"), c.get("user").id, file)
			return c.json({ file: agentFileResponseSchema.parse(uploaded) }, HTTP_STATUS.CREATED)
		} catch (error) {
			if (error instanceof service.AgentNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof service.InvalidFileError) {
				return c.json({ error: error.message }, HTTP_STATUS.BAD_REQUEST)
			}
			throw error
		}
	})
	.patch("/api/agents/:id/files/:fileId", async (c) => {
		const body = renameAgentFileRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			const renamed = await service.renameFile(
				c.req.param("id"),
				c.req.param("fileId"),
				c.get("user").id,
				body.data.name,
			)
			return c.json({ file: agentFileResponseSchema.parse(renamed) })
		} catch (error) {
			if (error instanceof service.AgentNotFoundError || error instanceof service.AgentFileNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof service.InvalidFileError) {
				return c.json({ error: error.message }, HTTP_STATUS.BAD_REQUEST)
			}
			throw error
		}
	})
	.delete("/api/agents/:id/files/:fileId", async (c) => {
		try {
			await service.deleteFile(c.req.param("id"), c.req.param("fileId"), c.get("user").id)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			if (error instanceof service.AgentNotFoundError || error instanceof service.AgentFileNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
