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
import { WIDGET_POSITIONS, WIDGET_THEMES } from "@talqo/shared/widget-appearance"

import { WIDGET_NAME_MAX_LENGTH } from "./widget.service.ts"

// Six-digit hex only: the widget writes these straight into CSS custom properties,
// where any other notation would need normalising first.
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color, e.g. #1a7f4b")
const nameSchema = z.string().trim().min(1).max(WIDGET_NAME_MAX_LENGTH)

const appearanceInputSchema = z
	.object({
		primary: colorSchema,
		primaryForeground: colorSchema,
		background: colorSchema,
		foreground: colorSchema,
		position: z.enum(WIDGET_POSITIONS),
		theme: z.enum(WIDGET_THEMES),
		themeToggle: z.boolean(),
		language: z.enum(SUPPORTED_LANGUAGES),
	})
	// Identical members of a pair render invisible text. Contrast beyond that is the
	// operator's call -- the dashboard warns rather than blocking their brand colors.
	.refine((appearance) => appearance.primary.toLowerCase() !== appearance.primaryForeground.toLowerCase(), {
		message: "Primary and its foreground must differ",
		path: ["primaryForeground"],
	})
	.refine((appearance) => appearance.background.toLowerCase() !== appearance.foreground.toLowerCase(), {
		message: "Background and foreground must differ",
		path: ["foreground"],
	})

// Looser than the input schema on purpose: `language` is widened on read so a widget
// saved under a language later dropped from `@talqo/shared` stays readable.
const appearanceResponseSchema = z
	.object({
		primary: z.string(),
		primaryForeground: z.string(),
		background: z.string(),
		foreground: z.string(),
		position: z.enum(WIDGET_POSITIONS),
		theme: z.enum(WIDGET_THEMES),
		themeToggle: z.boolean(),
		language: z.string(),
	})
	.openapi("WidgetAppearance")

export const widgetResponseSchema = z
	.object({
		id: z.string(),
		agentId: z.string(),
		name: z.string(),
		publicToken: z.string(),
		appearance: appearanceResponseSchema,
	})
	.openapi("Widget")

export const widgetConfigResponseSchema = z
	.object({
		version: z.number(),
		agentId: z.string(),
		appearance: appearanceResponseSchema,
	})
	.openapi("WidgetConfig")

// Whole-object on both write paths: the pair refinements have nothing to compare a lone
// color against, so a sparse appearance could not be checked without first reading the row.
const widgetInputSchema = z.object({
	agentId: z.string().min(1),
	name: nameSchema,
	appearance: appearanceInputSchema,
})

export const createWidgetRequestSchema = widgetInputSchema
export const updateWidgetRequestSchema = widgetInputSchema

export const widgetDetailResponseSchema = z.object({ widget: widgetResponseSchema })
export const widgetListResponseSchema = z.object({ widgets: z.array(widgetResponseSchema) })

const widgetParamsSchema = z.object({
	widgetId: z.string().openapi({ param: { name: "widgetId", in: "path" } }),
})

const widgetTokenParamsSchema = z.object({
	token: z.string().openapi({ param: { name: "token", in: "path" } }),
})

// Conditional GET: an unchanged configuration carries no body to describe.
const notModifiedResponse = { description: "Configuration unchanged since the supplied ETag" } as const

export const listWidgetsRoute = createRoute({
	method: "get",
	path: "/",
	operationId: "listWidgets",
	tags: ["Widget"],
	security: sessionSecurity,
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

// Deliberately unauthenticated (ADR-0013): it is reachable from arbitrary customer
// origins, so it carries no security scheme and returns identity-free appearance only.
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
