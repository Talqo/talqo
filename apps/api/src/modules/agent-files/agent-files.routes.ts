import type { AuthedVariables } from "@/http/require-auth.ts"

import { HTTP_STATUS } from "@/http/status.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import {
	agentFileDetailResponseSchema,
	agentFileListResponseSchema,
	deleteAgentFileRoute,
	listAgentFilesRoute,
	renameAgentFileRoute,
	uploadAgentFileRoute,
} from "./agent-files.contract.ts"
import * as files from "./agent-files.service.ts"

function mapDomainError(error: unknown): { body: { error: string }; status: number } | null {
	if (error instanceof files.InvalidFileError) {
		return { body: { error: error.message }, status: HTTP_STATUS.BAD_REQUEST }
	}
	if (error instanceof agent.AgentNotFoundError || error instanceof files.FileNotFoundError) {
		return { body: { error: "Not found" }, status: HTTP_STATUS.NOT_FOUND }
	}
	if (error instanceof files.FileExistsError) {
		return { body: { error: error.message }, status: HTTP_STATUS.CONFLICT }
	}
	return null
}

function serialize(file: files.StoredFile) {
	return { ...file, createdAt: file.createdAt.toISOString() }
}

// The agent must exist before any file operation: with no agent↔context table, the
// agent row is the only thing that proves the upload directory belongs to a live agent.
async function requireAgent(agentId: string): Promise<void> {
	await agent.getAgent(agentId)
}

export const agentFilesRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(listAgentFilesRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return c.json({ error: "Missing agents:manage permission" }, HTTP_STATUS.FORBIDDEN)
		}
		const agentId = c.req.valid("param").agentId
		try {
			await requireAgent(agentId)
			return c.json(
				agentFileListResponseSchema.parse({
					files: (await files.list(agentId)).map(serialize),
					maxSizeBytes: files.MAX_FILE_SIZE_MB * files.BYTES_PER_MB,
					maxNameLength: files.MAX_FILE_NAME_LENGTH,
				}),
				HTTP_STATUS.OK,
			)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return c.json(mapped.body, mapped.status as never)
			throw error
		}
	})
	.openapi(uploadAgentFileRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return c.json({ error: "Missing agents:manage permission" }, HTTP_STATUS.FORBIDDEN)
		}
		const agentId = c.req.valid("param").agentId
		const body = c.req.valid("form")
		const file = body["file"]
		if (!(file instanceof File)) {
			return c.json({ error: "Multipart field 'file' is required" }, HTTP_STATUS.BAD_REQUEST)
		}
		try {
			await requireAgent(agentId)
			files.validateUpload(file)
			const stored = await files.put(agentId, file.name, await file.arrayBuffer())
			return c.json(agentFileDetailResponseSchema.parse({ file: serialize(stored) }), HTTP_STATUS.CREATED)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return c.json(mapped.body, mapped.status as never)
			throw error
		}
	})
	.openapi(renameAgentFileRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return c.json({ error: "Missing agents:manage permission" }, HTTP_STATUS.FORBIDDEN)
		}
		const { agentId, fileName } = c.req.valid("param")
		// URL-decoded before routing: %2F reaches us as a literal "/", so traversal must be rejected here.
		try {
			await requireAgent(agentId)
			files.validatePathName(fileName)
			const target = files.resolveRenameTarget(fileName, c.req.valid("json").name)
			const renamed = await files.renameFile(agentId, fileName, target)
			return c.json(agentFileDetailResponseSchema.parse({ file: serialize(renamed) }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return c.json(mapped.body, mapped.status as never)
			throw error
		}
	})
	.openapi(deleteAgentFileRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return c.json({ error: "Missing agents:manage permission" }, HTTP_STATUS.FORBIDDEN)
		}
		const { agentId, fileName } = c.req.valid("param")
		try {
			await requireAgent(agentId)
			files.validatePathName(fileName)
			await files.remove(agentId, fileName)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return c.json(mapped.body, mapped.status as never)
			throw error
		}
	})
