import { noContentResponse, payloadTooLargeResponse, problemResponse, sessionSecurity } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import { createRoute, z } from "@hono/zod-openapi"
import { SUPPORTED_LANGUAGES } from "@talqo/shared/languages"
import { HEX_COLOR_MESSAGE, HEX_COLOR_PATTERN, WIDGET_POSITIONS, WIDGET_THEMES } from "@talqo/shared/widget-appearance"

import { EMBED_NAME_MAX_LENGTH } from "./embed.service.ts"

// Shared with the widget: colors it rejects would silently fall back to defaults.
const colorSchema = z.string().regex(HEX_COLOR_PATTERN, HEX_COLOR_MESSAGE)
const nameSchema = z.string().trim().min(1).max(EMBED_NAME_MAX_LENGTH)

// Exactly the five colors the widget paints with; nothing here derives a tone or hue.
const schemeInputSchema = z
	.object({
		primary: colorSchema,
		textOnPrimary: colorSchema,
		background: colorSchema,
		surface: colorSchema,
		text: colorSchema,
	})
	// Identical pairs render invisible text; weaker contrast is the operator's call to make.
	.refine((scheme) => scheme.primary.toLowerCase() !== scheme.textOnPrimary.toLowerCase(), {
		message: "Primary and its on-primary text must differ",
		path: ["textOnPrimary"],
	})
	.refine((scheme) => scheme.background.toLowerCase() !== scheme.text.toLowerCase(), {
		message: "Background and text must differ",
		path: ["text"],
	})

const appearanceInputSchema = z.object({
	light: schemeInputSchema,
	dark: schemeInputSchema,
	position: z.enum(WIDGET_POSITIONS),
	theme: z.enum(WIDGET_THEMES),
	themeToggle: z.boolean(),
	language: z.enum(SUPPORTED_LANGUAGES),
})

const schemeResponseSchema = z
	.object({
		primary: z.string(),
		textOnPrimary: z.string(),
		background: z.string(),
		surface: z.string(),
		text: z.string(),
	})
	.openapi("EmbedScheme")

// `language` is widened on read so a widget saved under a since-dropped language stays readable.
const appearanceResponseSchema = z
	.object({
		light: schemeResponseSchema,
		dark: schemeResponseSchema,
		position: z.enum(WIDGET_POSITIONS),
		theme: z.enum(WIDGET_THEMES),
		themeToggle: z.boolean(),
		language: z.string(),
	})
	.openapi("EmbedAppearance")

const embedResponseSchema = z
	.object({
		id: z.string(),
		agentId: z.string(),
		name: z.string(),
		embedToken: z.string(),
		accessVersion: z.number().int().positive(),
		appearance: appearanceResponseSchema,
	})
	.openapi("Embed")

// `name` is public here on purpose (FR-2.5 UX review): the embedded chat header shows it.
export const embedConfigResponseSchema = z
	.object({
		version: z.number(),
		name: z.string(),
		appearance: appearanceResponseSchema,
	})
	.openapi("EmbedConfig")

// Whole-object on both write paths: the pair refinements cannot check a lone color.
const embedInputSchema = z.object({
	agentId: z.string().min(1),
	name: nameSchema,
	appearance: appearanceInputSchema,
})

export const embedDetailResponseSchema = z.object({ embed: embedResponseSchema })
export const embedListResponseSchema = z.object({ embeds: z.array(embedResponseSchema) })

const embedParamsSchema = z.object({
	embedId: z.string().openapi({ param: { name: "embedId", in: "path" } }),
})

const embedTokenParamsSchema = z.object({
	embedToken: z.string().openapi({ param: { name: "embedToken", in: "path" } }),
})

// Optional: the agent detail page filters here rather than client-side, so it never fetches
// every embed in the deployment to show the handful that serve one agent.
const listEmbedsQuerySchema = z.object({
	agentId: z
		.string()
		.optional()
		.openapi({ param: { name: "agentId", in: "query" } }),
})

const notModifiedResponse = { description: "Configuration unchanged since the supplied ETag" } as const
const invalidRequest = problemResponse([PROBLEM_CODES.INVALID_REQUEST, PROBLEM_CODES.MALFORMED_JSON])
const authRequired = problemResponse([PROBLEM_CODES.AUTHENTICATION_REQUIRED])
const forbidden = problemResponse([PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED, PROBLEM_CODES.PERMISSION_DENIED])
const embedNotFound = problemResponse([PROBLEM_CODES.EMBED_NOT_FOUND])
const serverError = problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR])

export const listEmbedsRoute = createRoute({
	method: "get",
	path: "/",
	operationId: "listEmbeds",
	tags: ["Embed"],
	security: sessionSecurity,
	request: { query: listEmbedsQuerySchema },
	responses: {
		200: { content: { "application/json": { schema: embedListResponseSchema } }, description: "All embeds" },
		401: authRequired,
		403: forbidden,
		500: serverError,
	},
})

export const createEmbedRoute = createRoute({
	method: "post",
	path: "/",
	operationId: "createEmbed",
	tags: ["Embed"],
	security: sessionSecurity,
	request: {
		body: { content: { "application/json": { schema: embedInputSchema } }, required: true },
	},
	responses: {
		201: { content: { "application/json": { schema: embedDetailResponseSchema } }, description: "Embed created" },
		400: invalidRequest,
		401: authRequired,
		403: forbidden,
		404: problemResponse([PROBLEM_CODES.AGENT_NOT_FOUND]),
		413: payloadTooLargeResponse,
		500: serverError,
	},
})

export const getEmbedRoute = createRoute({
	method: "get",
	path: "/{embedId}",
	operationId: "getEmbed",
	tags: ["Embed"],
	security: sessionSecurity,
	request: { params: embedParamsSchema },
	responses: {
		200: { content: { "application/json": { schema: embedDetailResponseSchema } }, description: "One embed" },
		401: authRequired,
		403: forbidden,
		404: embedNotFound,
		500: serverError,
	},
})

export const updateEmbedRoute = createRoute({
	method: "put",
	path: "/{embedId}",
	operationId: "updateEmbed",
	tags: ["Embed"],
	security: sessionSecurity,
	request: {
		params: embedParamsSchema,
		body: { content: { "application/json": { schema: embedInputSchema } }, required: true },
	},
	responses: {
		200: { content: { "application/json": { schema: embedDetailResponseSchema } }, description: "Embed updated" },
		400: invalidRequest,
		401: authRequired,
		403: forbidden,
		404: problemResponse([PROBLEM_CODES.AGENT_NOT_FOUND, PROBLEM_CODES.EMBED_NOT_FOUND]),
		413: payloadTooLargeResponse,
		500: serverError,
	},
})

export const rotateEmbedTokenRoute = createRoute({
	method: "post",
	path: "/{embedId}/embed-token/rotate",
	operationId: "rotateEmbedToken",
	tags: ["Embed"],
	security: sessionSecurity,
	request: { params: embedParamsSchema },
	responses: {
		200: { content: { "application/json": { schema: embedDetailResponseSchema } }, description: "Embed token rotated" },
		401: authRequired,
		403: forbidden,
		404: embedNotFound,
		500: serverError,
	},
})

export const deleteEmbedRoute = createRoute({
	method: "delete",
	path: "/{embedId}",
	operationId: "deleteEmbed",
	tags: ["Embed"],
	security: sessionSecurity,
	request: { params: embedParamsSchema },
	responses: {
		204: noContentResponse,
		401: authRequired,
		403: forbidden,
		404: embedNotFound,
		500: serverError,
	},
})

// Unauthenticated (ADR-0013): reachable from any customer origin, so the widget's internal id stays out of it.
export const getEmbedConfigRoute = createRoute({
	method: "get",
	path: "/{embedToken}",
	operationId: "getEmbedConfig",
	tags: ["Embed"],
	request: { params: embedTokenParamsSchema },
	responses: {
		200: {
			content: { "application/json": { schema: embedConfigResponseSchema } },
			description: "Public appearance for the embedded widget",
		},
		304: notModifiedResponse,
		404: embedNotFound,
		500: serverError,
	},
})
