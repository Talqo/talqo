import type { Context } from "hono"

import { allowPublic } from "@/http/access.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import {
	createEmbedRoute,
	deleteEmbedRoute,
	disableEmbedRoute,
	embedConfigResponseSchema,
	embedDetailResponseSchema,
	embedListResponseSchema,
	enableEmbedRoute,
	getEmbedConfigRoute,
	getEmbedRoute,
	listEmbedsRoute,
	rotateEmbedTokenRoute,
	updateEmbedRoute,
} from "./embed.contract.ts"
import * as service from "./embed.service.ts"

// There is no purge, so this bounds how long a live site keeps a stale palette. No
// stale-while-revalidate: a shared cache would serve it past the window ADR-0013 promises.
const CONFIG_MAX_AGE_SECONDS = 60

function serveEmbedConfig(c: Context) {
	return service.getConfigByToken(c.req.param("embedToken")!).then((config) => {
		const etag = `W/"${config.updatedAt.getTime()}"`
		if (c.req.header("if-none-match") === etag) return c.body(null, HTTP_STATUS.NOT_MODIFIED)
		c.header("Cache-Control", `public, max-age=${CONFIG_MAX_AGE_SECONDS}`)
		c.header("ETag", etag)
		return c.json(embedConfigResponseSchema.parse(config), HTTP_STATUS.OK)
	})
}

export const embedRoutes = new OpenAPIHono()
	.openapi(listEmbedsRoute, async (c) => {
		const { agentId } = c.req.valid("query")
		return c.json(embedListResponseSchema.parse({ embeds: await service.listEmbeds(agentId) }), HTTP_STATUS.OK)
	})
	.openapi(createEmbedRoute, async (c) => {
		const embed = await service.createEmbed(c.req.valid("json"))
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.CREATED)
	})
	.openapi(getEmbedRoute, async (c) => {
		const embed = await service.getEmbed(c.req.valid("param").embedId)
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(updateEmbedRoute, async (c) => {
		const embed = await service.updateEmbed(c.req.valid("param").embedId, c.req.valid("json"))
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(rotateEmbedTokenRoute, async (c) => {
		const embed = await service.rotateEmbedToken(c.req.valid("param").embedId)
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(disableEmbedRoute, async (c) => {
		const embed = await service.disableEmbed(c.req.valid("param").embedId)
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(enableEmbedRoute, async (c) => {
		const embed = await service.enableEmbed(c.req.valid("param").embedId)
		return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
	})
	.openapi(deleteEmbedRoute, async (c) => {
		await service.deleteEmbed(c.req.valid("param").embedId)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})

export const embedConfigRoutes = new OpenAPIHono().openapi(getEmbedConfigRoute, serveEmbedConfig)

// Compatibility only for already shipped data-talqo-widget snippets. Keep it out of OpenAPI.
export const legacyWidgetConfigRoutes = new OpenAPIHono().get("/:embedToken", allowPublic, serveEmbedConfig)
