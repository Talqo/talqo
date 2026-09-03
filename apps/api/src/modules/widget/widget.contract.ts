import {
	badRequestResponse,
	forbiddenResponse,
	internalServerErrorResponse,
	noContentResponse,
	notFoundResponse,
	sessionSecurity,
	unauthorizedResponse,
} from "@/http/openapi.ts"
import { createRoute, z } from "@hono/zod-openapi"
import { SUPPORTED_LANGUAGES } from "@talqo/shared/languages"
import { HEX_COLOR_MESSAGE, HEX_COLOR_PATTERN, WIDGET_POSITIONS, WIDGET_THEMES } from "@talqo/shared/widget-appearance"

import { WIDGET_NAME_MAX_LENGTH } from "./widget.service.ts"

// Shared with the widget: colors it rejects would silently fall back to defaults.
const colorSchema = z.string().regex(HEX_COLOR_PATTERN, HEX_COLOR_MESSAGE)
const nameSchema = z.string().trim().min(1).max(WIDGET_NAME_MAX_LENGTH)

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
	.openapi("WidgetScheme")

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
	.openapi("WidgetAppearance")

const widgetResponseSchema = z
	.object({
		id: z.string(),
		agentId: z.string(),
		name: z.string(),
		publicToken: z.string(),
		appearance: appearanceResponseSchema,
	})
	.openapi("Widget")

// `name` is public here on purpose (FR-2.5 UX review): the embedded chat header shows it.
export const widgetConfigResponseSchema = z
	.object({
		version: z.number(),
		agentId: z.string(),
		name: z.string(),
		appearance: appearanceResponseSchema,
	})
	.openapi("WidgetConfig")

// Whole-object on both write paths: the pair refinements cannot check a lone color.
const widgetInputSchema = z.object({
	agentId: z.string().min(1),
	name: nameSchema,
	appearance: appearanceInputSchema,
})

const createWidgetRequestSchema = widgetInputSchema
const updateWidgetRequestSchema = widgetInputSchema

export const widgetDetailResponseSchema = z.object({ widget: widgetResponseSchema })
export const widgetListResponseSchema = z.object({ widgets: z.array(widgetResponseSchema) })

const widgetParamsSchema = z.object({
	widgetId: z.string().openapi({ param: { name: "widgetId", in: "path" } }),
})

const widgetTokenParamsSchema = z.object({
	token: z.string().openapi({ param: { name: "token", in: "path" } }),
})

// Optional: the agent detail page filters here rather than client-side, so it never fetches
// every widget in the deployment to show the handful that serve one agent.
const listWidgetsQuerySchema = z.object({
	agentId: z
		.string()
		.optional()
		.openapi({ param: { name: "agentId", in: "query" } }),
})

const notModifiedResponse = { description: "Configuration unchanged since the supplied ETag" } as const

export const listWidgetsRoute = createRoute({
	method: "get",
	path: "/",
	operationId: "listWidgets",
	tags: ["Widget"],
	security: sessionSecurity,
	request: { query: listWidgetsQuerySchema },
	responses: {
		200: { content: { "application/json": { schema: widgetListResponseSchema } }, description: "All widgets" },
		401: unauthorizedResponse,
		403: forbiddenResponse,
		500: internalServerErrorResponse,
	},
})

export const createWidgetRoute = createRoute({
	method: "post",
	path: "/",
	operationId: "createWidget",
	tags: ["Widget"],
	security: sessionSecurity,
	request: {
		body: { content: { "application/json": { schema: createWidgetRequestSchema } }, required: true },
	},
	responses: {
		201: { content: { "application/json": { schema: widgetDetailResponseSchema } }, description: "Widget created" },
		400: badRequestResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		500: internalServerErrorResponse,
	},
})

export const getWidgetRoute = createRoute({
	method: "get",
	path: "/{widgetId}",
	operationId: "getWidget",
	tags: ["Widget"],
	security: sessionSecurity,
	request: { params: widgetParamsSchema },
	responses: {
		200: { content: { "application/json": { schema: widgetDetailResponseSchema } }, description: "One widget" },
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		500: internalServerErrorResponse,
	},
})

export const updateWidgetRoute = createRoute({
	method: "put",
	path: "/{widgetId}",
	operationId: "updateWidget",
	tags: ["Widget"],
	security: sessionSecurity,
	request: {
		params: widgetParamsSchema,
		body: { content: { "application/json": { schema: updateWidgetRequestSchema } }, required: true },
	},
	responses: {
		200: { content: { "application/json": { schema: widgetDetailResponseSchema } }, description: "Widget updated" },
		400: badRequestResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		500: internalServerErrorResponse,
	},
})

export const deleteWidgetRoute = createRoute({
	method: "delete",
	path: "/{widgetId}",
	operationId: "deleteWidget",
	tags: ["Widget"],
	security: sessionSecurity,
	request: { params: widgetParamsSchema },
	responses: {
		204: noContentResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		500: internalServerErrorResponse,
	},
})

// Unauthenticated (ADR-0013): reachable from any customer origin, so the widget's internal id stays out of it.
export const getWidgetConfigRoute = createRoute({
	method: "get",
	path: "/{token}",
	operationId: "getWidgetConfig",
	tags: ["Widget"],
	request: { params: widgetTokenParamsSchema },
	responses: {
		200: {
			content: { "application/json": { schema: widgetConfigResponseSchema } },
			description: "Public appearance for the embedded widget",
		},
		304: notModifiedResponse,
		404: notFoundResponse,
		500: internalServerErrorResponse,
	},
})
