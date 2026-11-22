import type { Context } from "hono"

import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { annotate, annotator } from "@/http/wide-event.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { EMBED_ICON_MAX_BYTES } from "@talqo/shared/embed-icon"
import { bodyLimit } from "hono/body-limit"

import {
	createEmbedRoute,
	deleteEmbedIconRoute,
	deleteEmbedRoute,
	disableEmbedRoute,
	embedConfigResponseSchema,
	embedDetailResponseSchema,
	embedListResponseSchema,
	enableEmbedRoute,
	getEmbedConfigRoute,
	getEmbedIconRoute,
	getEmbedRoute,
	listEmbedsRoute,
	rotateEmbedTokenRoute,
	setEmbedIconRoute,
	updateEmbedRoute,
} from "./embed.contract.ts"
import * as service from "./embed.service.ts"

// There is no purge, so this bounds how long a live site keeps a stale palette. No
// stale-while-revalidate: a shared cache would serve it past the window ADR-0013 promises.
const CONFIG_MAX_AGE_SECONDS = 60

function serveEmbedConfig(c: Context) {
	return service.getConfigByToken(c.req.param("embedToken")!, annotator(c)).then((config) => {
		// Availability follows the AI provider and the icon lives on disk, so neither moves the row; both vary the tag.
		const etag = `W/"${config.updatedAt.getTime()}-${config.isAvailable ? 1 : 0}-${config.iconUrl ?? ""}"`
		if (c.req.header("if-none-match") === etag) return c.body(null, HTTP_STATUS.NOT_MODIFIED)
		c.header("Cache-Control", `public, max-age=${CONFIG_MAX_AGE_SECONDS}`)
		c.header("ETag", etag)
		return c.json(embedConfigResponseSchema.parse(config), HTTP_STATUS.OK)
	})
}

// Multipart bodies skip the global JSON limit; the margin covers boundaries and part headers.
const MULTIPART_MARGIN_BYTES = 16_384
const iconBodyLimit = bodyLimit({
	maxSize: EMBED_ICON_MAX_BYTES + MULTIPART_MARGIN_BYTES,
	onError: (c) => problemResponse(c, PROBLEM_CODES.PAYLOAD_TOO_LARGE, HTTP_STATUS.PAYLOAD_TOO_LARGE),
})

const routes = new OpenAPIHono()
routes.use("/:embedId/icon", iconBodyLimit)

export const embedRoutes = routes
	.openapi(listEmbedsRoute, async (c) => {
		const { agentId } = c.req.valid("query")
		return c.json(
			embedListResponseSchema.parse({ embeds: await service.listVisibleEmbeds(c.get("user").id, agentId) }),
			HTTP_STATUS.OK,
		)
	})
	.openapi(createEmbedRoute, async (c) => {
		const embed = await service.createEmbed(c.req.valid("json"), c.get("user").id)
		annotate(c, { "embed.id": embed.id, "agent.id": embed.agentId })
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.CREATED)
	})
	.openapi(getEmbedRoute, async (c) => {
		const embed = await service.getEmbed(c.req.valid("param").embedId, c.get("user").id)
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(updateEmbedRoute, async (c) => {
		const embed = await service.updateEmbed(c.req.valid("param").embedId, c.req.valid("json"), c.get("user").id)
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(rotateEmbedTokenRoute, async (c) => {
		const embed = await service.rotateEmbedToken(c.req.valid("param").embedId, c.get("user").id)
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(disableEmbedRoute, async (c) => {
		const embed = await service.disableEmbed(c.req.valid("param").embedId, c.get("user").id)
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(enableEmbedRoute, async (c) => {
		const embed = await service.enableEmbed(c.req.valid("param").embedId, c.get("user").id)
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(setEmbedIconRoute, async (c) => {
		const file = c.req.valid("form").file
		if (!(file instanceof File)) return problemResponse(c, PROBLEM_CODES.EMBED_ICON_INVALID, HTTP_STATUS.BAD_REQUEST)
		annotate(c, { "file.size": file.size })
		const embed = await service.setEmbedIcon(c.req.valid("param").embedId, await file.arrayBuffer(), c.get("user").id)
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(deleteEmbedIconRoute, async (c) => {
		const embed = await service.removeEmbedIcon(c.req.valid("param").embedId, c.get("user").id)
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(deleteEmbedRoute, async (c) => {
		await service.deleteEmbed(c.req.valid("param").embedId, c.get("user").id)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})

// Opening the URL directly renders the SVG as a document on the API origin; the sandbox CSP keeps its scripts inert there.
const ICON_HEADERS = {
	"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
	"X-Content-Type-Options": "nosniff",
	"Cross-Origin-Resource-Policy": "cross-origin",
	"Cache-Control": `public, max-age=${CONFIG_MAX_AGE_SECONDS}`,
} as const

export const embedConfigRoutes = new OpenAPIHono()
	.openapi(getEmbedConfigRoute, serveEmbedConfig)
	.openapi(getEmbedIconRoute, async (c) => {
		const { content, version } = await service.getIconByToken(c.req.valid("param").embedToken)
		const etag = `"${version}"`
		if (c.req.header("if-none-match") === etag) return c.body(null, HTTP_STATUS.NOT_MODIFIED, { ETag: etag })
		return c.body(new Uint8Array(content), HTTP_STATUS.OK, {
			...ICON_HEADERS,
			"Content-Type": "image/svg+xml",
			ETag: etag,
		})
	})
