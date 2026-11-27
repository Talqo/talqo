import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { annotate } from "@/http/wide-event.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { bodyLimit } from "hono/body-limit"

import {
	agentFileDetailResponseSchema,
	agentFileListResponseSchema,
	agentWebsiteDetailResponseSchema,
	agentWebsiteListResponseSchema,
	addAgentWebsiteRoute,
	deleteAgentWebsiteRoute,
	deleteAgentFileRoute,
	downloadAgentFileRoute,
	listAgentFilesRoute,
	listAgentWebsitesRoute,
	refreshAgentWebsiteRoute,
	renameAgentFileRoute,
	retryAgentFileRoute,
	uploadAgentFileRoute,
} from "./knowledge-base.contract.ts"
import * as knowledgeBase from "./knowledge-base.service.ts"

function serialize(file: knowledgeBase.IndexedFile) {
	return { ...file, createdAt: file.createdAt.toISOString() }
}

function serializeWebsite(website: knowledgeBase.IndexedWebsite) {
	return { ...website, createdAt: website.createdAt.toISOString() }
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
	maxSize: knowledgeBase.MAX_UPLOAD_BODY_BYTES,
	onError: (c) => problemResponse(c, PROBLEM_CODES.PAYLOAD_TOO_LARGE, HTTP_STATUS.PAYLOAD_TOO_LARGE),
})

const filesRoutes = new OpenAPIHono()
	.openapi(listAgentFilesRoute, async (c) => {
		const agentId = c.req.valid("param").agentId
		await requireAgent(agentId)
		const listed = await knowledgeBase.listWithStatus(agentId)
		return c.json(
			agentFileListResponseSchema.parse({
				files: listed.map(serialize),
				maxSizeBytes: knowledgeBase.MAX_FILE_SIZE_BYTES,
				maxNameLength: knowledgeBase.MAX_FILE_NAME_LENGTH,
				allowedExtensions: [...knowledgeBase.ALLOWED_EXTENSIONS],
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
		annotate(c, { "file.extension": knowledgeBase.uploadExtension(file.name), "file.size": file.size })
		await requireAgent(agentId)
		knowledgeBase.validateUpload(file)
		const stored = await knowledgeBase.upload(agentId, file.name, await file.arrayBuffer())
		return c.json(agentFileDetailResponseSchema.parse({ file: serialize(stored) }), HTTP_STATUS.CREATED)
	})
	.openapi(downloadAgentFileRoute, async (c) => {
		const { agentId, fileName } = c.req.valid("param")
		// URL-decoded before routing: %2F reaches us as a literal "/", so traversal must be rejected here.
		await requireAgent(agentId)
		knowledgeBase.validateName(fileName)
		const content = await knowledgeBase.get(agentId, fileName)
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
		knowledgeBase.validateName(fileName)
		const target = knowledgeBase.resolveRenameTarget(fileName, c.req.valid("json").name)
		const renamed = await knowledgeBase.rename(agentId, fileName, target)
		return c.json(agentFileDetailResponseSchema.parse({ file: serialize(renamed) }), HTTP_STATUS.OK)
	})
	.openapi(deleteAgentFileRoute, async (c) => {
		const { agentId, fileName } = c.req.valid("param")
		await requireAgent(agentId)
		knowledgeBase.validateName(fileName)
		await knowledgeBase.deleteFile(agentId, fileName)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
	.openapi(retryAgentFileRoute, async (c) => {
		const { agentId, fileName } = c.req.valid("param")
		await requireAgent(agentId)
		knowledgeBase.validateName(fileName)
		await knowledgeBase.retryEmbedding(agentId, fileName)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})

const websiteRoutes = new OpenAPIHono()
	.openapi(listAgentWebsitesRoute, async (c) => {
		const agentId = c.req.valid("param").agentId
		await requireAgent(agentId)
		const websites = await knowledgeBase.listWebsites(agentId)
		return c.json(
			agentWebsiteListResponseSchema.parse({
				websites: websites.map(serializeWebsite),
				maxPages: knowledgeBase.MAX_WEBSITE_PAGES,
			}),
			HTTP_STATUS.OK,
		)
	})
	.openapi(addAgentWebsiteRoute, async (c) => {
		const agentId = c.req.valid("param").agentId
		await requireAgent(agentId)
		const website = await knowledgeBase.addWebsite(agentId, c.req.valid("json").url)
		annotate(c, { "website.id": website.id })
		return c.json(
			agentWebsiteDetailResponseSchema.parse({ website: serializeWebsite(website) }),
			HTTP_STATUS.CREATED,
		)
	})
	.openapi(refreshAgentWebsiteRoute, async (c) => {
		const { agentId, websiteId } = c.req.valid("param")
		await requireAgent(agentId)
		await knowledgeBase.refreshWebsite(agentId, websiteId)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
	.openapi(deleteAgentWebsiteRoute, async (c) => {
		const { agentId, websiteId } = c.req.valid("param")
		await requireAgent(agentId)
		await knowledgeBase.deleteWebsite(agentId, websiteId)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})

const routes = new OpenAPIHono()
routes.use("/:agentId/files", uploadBodyLimit)
routes.route("/:agentId/files", filesRoutes)
routes.route("/:agentId/websites", websiteRoutes)

export const knowledgeBaseRoutes = routes
