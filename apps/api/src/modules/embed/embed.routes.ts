import type { Context } from "hono"

import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
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

function mapDomainError(error: unknown) {
	if (error instanceof service.EmbedNotFoundError) {
		return { code: PROBLEM_CODES.EMBED_NOT_FOUND, status: HTTP_STATUS.NOT_FOUND } as const
	}
	if (error instanceof service.UnknownAgentError) {
		return { code: PROBLEM_CODES.AGENT_NOT_FOUND, status: HTTP_STATUS.NOT_FOUND } as const
	}
	return null
}

function serveEmbedConfig(c: Context) {
	return service
		.getConfigByToken(c.req.param("embedToken")!)
		.then((config) => {
			const etag = `W/"${config.updatedAt.getTime()}"`
			if (c.req.header("if-none-match") === etag) return c.body(null, HTTP_STATUS.NOT_MODIFIED)
			c.header("Cache-Control", `public, max-age=${CONFIG_MAX_AGE_SECONDS}`)
			c.header("ETag", etag)
			return c.json(embedConfigResponseSchema.parse(config), HTTP_STATUS.OK)
		})
		.catch((error: unknown) => {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		})
}

export const embedRoutes = new OpenAPIHono()
	.openapi(listEmbedsRoute, async (c) => {
		const { agentId } = c.req.valid("query")
		return c.json(embedListResponseSchema.parse({ embeds: await service.listEmbeds(agentId) }), HTTP_STATUS.OK)
	})
	.openapi(createEmbedRoute, async (c) => {
		try {
			const embed = await service.createEmbed(c.req.valid("json"))
			return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.CREATED)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
	.openapi(getEmbedRoute, async (c) => {
		try {
			const embed = await service.getEmbed(c.req.valid("param").embedId)
			return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
	.openapi(updateEmbedRoute, async (c) => {
		try {
			const embed = await service.updateEmbed(c.req.valid("param").embedId, c.req.valid("json"))
			return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
	.openapi(rotateEmbedTokenRoute, async (c) => {
		try {
			const embed = await service.rotateEmbedToken(c.req.valid("param").embedId)
			return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
	.openapi(disableEmbedRoute, async (c) => {
		try {
			const embed = await service.disableEmbed(c.req.valid("param").embedId)
			return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
	.openapi(enableEmbedRoute, async (c) => {
		try {
			const embed = await service.enableEmbed(c.req.valid("param").embedId)
			return c.json(embedDetailResponseSchema.parse({ embed }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})
	.openapi(deleteEmbedRoute, async (c) => {
		try {
			await service.deleteEmbed(c.req.valid("param").embedId)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status)
			throw error
		}
	})

export const embedConfigRoutes = new OpenAPIHono().openapi(getEmbedConfigRoute, serveEmbedConfig)
