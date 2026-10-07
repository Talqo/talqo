import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { bodyLimit } from "hono/body-limit"

import {
	agentFileDetailResponseSchema,
	agentFileListResponseSchema,
	deleteAgentFileRoute,
	downloadAgentFileRoute,
	listAgentFilesRoute,
	renameAgentFileRoute,
	retryAgentFileRoute,
	uploadAgentFileRoute,
} from "./knowledge-base.contract.ts"
import * as files from "./knowledge-base.service.ts"

function serialize(file: files.IndexedFile) {
	return { ...file, createdAt: file.createdAt.toISOString() }
}

async function requireAgent(agentId: string): Promise<void> {
	await agent.getAgent(agentId)
}

// RFC 5987: filename* carries the UTF-8 name; a quoted ASCII fallback serves older clients.
function contentDisposition(name: string): string {
	const fallback = name.replace(/[^\x20-\x7E]|["\\]/g, "_")
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

const uploadBodyLimit = bodyLimit({
	maxSize: files.MAX_UPLOAD_BODY_BYTES,
	onError: (c) => problemResponse(c, PROBLEM_CODES.PAYLOAD_TOO_LARGE, HTTP_STATUS.PAYLOAD_TOO_LARGE),
})

const routes = new OpenAPIHono()
routes.use("/:agentId/files", uploadBodyLimit)

export const agentFilesRoutes = routes
	.openapi(listAgentFilesRoute, async (c) => {
		const agentId = c.req.valid("param").agentId
		await requireAgent(agentId)
		const listed = await files.listWithStatus(agentId)
		return c.json(
			agentFileListResponseSchema.parse({
				files: listed.map(serialize),
				maxSizeBytes: files.MAX_FILE_SIZE_BYTES,
				maxNameLength: files.MAX_FILE_NAME_LENGTH,
				allowedExtensions: [...files.ALLOWED_EXTENSIONS],
			}),
			HTTP_STATUS.OK,
		)
	})
	.openapi(uploadAgentFileRoute, async (c) => {
		const agentId = c.req.valid("param").agentId
		const body = c.req.valid("form")
		const file = body["file"]
		if (!(file instanceof File)) {
			return problemResponse(c, PROBLEM_CODES.AGENT_FILE_INVALID, HTTP_STATUS.BAD_REQUEST)
		}
		await requireAgent(agentId)
		files.validateUpload(file)
		const stored = await files.upload(agentId, file.name, await file.arrayBuffer())
		return c.json(agentFileDetailResponseSchema.parse({ file: serialize(stored) }), HTTP_STATUS.CREATED)
	})
	.openapi(downloadAgentFileRoute, async (c) => {
		const { agentId, fileName } = c.req.valid("param")
		// URL-decoded before routing: %2F reaches us as a literal "/", so traversal must be rejected here.
		await requireAgent(agentId)
		files.validateName(fileName)
		const content = await files.get(agentId, fileName)
		// attachment forces a download, so the generic type suffices; no per-format map to maintain.
		return c.body(new Uint8Array(content), HTTP_STATUS.OK, {
			"Content-Disposition": contentDisposition(fileName),
			"Content-Type": "application/octet-stream",
		})
	})
	.openapi(renameAgentFileRoute, async (c) => {
		const { agentId, fileName } = c.req.valid("param")
		// URL-decoded before routing: %2F reaches us as a literal "/", so traversal must be rejected here.
		await requireAgent(agentId)
		files.validateName(fileName)
		const target = files.resolveRenameTarget(fileName, c.req.valid("json").name)
		const renamed = await files.rename(agentId, fileName, target)
		return c.json(agentFileDetailResponseSchema.parse({ file: serialize(renamed) }), HTTP_STATUS.OK)
	})
	.openapi(deleteAgentFileRoute, async (c) => {
		const { agentId, fileName } = c.req.valid("param")
		await requireAgent(agentId)
		files.validateName(fileName)
		await files.deleteFile(agentId, fileName)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
	.openapi(retryAgentFileRoute, async (c) => {
		const { agentId, fileName } = c.req.valid("param")
		await requireAgent(agentId)
		files.validateName(fileName)
		await files.retryEmbedding(agentId, fileName)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
