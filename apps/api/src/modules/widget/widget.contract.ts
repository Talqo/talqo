import { supportedLanguages } from "@talqo/shared/languages"
import { WIDGET_POSITIONS, WIDGET_THEMES } from "@talqo/shared/widget-appearance"
import { z } from "zod"

import { WIDGET_NAME_MAX_LENGTH } from "./widget.service.ts"

const languages = Object.keys(supportedLanguages) as [string, ...string[]]

// Six-digit hex only: the widget writes these straight into CSS custom properties,
// where any other notation would need normalising first.
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color, e.g. #1a7f4b")
const nameSchema = z.string().trim().min(1).max(WIDGET_NAME_MAX_LENGTH)

const appearanceSchema = z
	.object({
		primary: colorSchema,
		primaryForeground: colorSchema,
		background: colorSchema,
		foreground: colorSchema,
		position: z.enum(WIDGET_POSITIONS),
		theme: z.enum(WIDGET_THEMES),
		themeToggle: z.boolean(),
		language: z.enum(languages),
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

const widgetSchema = z.object({
	id: z.string(),
	agentId: z.string(),
	name: z.string(),
	publicToken: z.string(),
	appearance: z.object({
		primary: z.string(),
		primaryForeground: z.string(),
		background: z.string(),
		foreground: z.string(),
		position: z.enum(WIDGET_POSITIONS),
		theme: z.enum(WIDGET_THEMES),
		themeToggle: z.boolean(),
		language: z.string(),
	}),
})

export const createWidgetRequestSchema = z.object({
	agentId: z.string().min(1),
	name: nameSchema,
	appearance: appearanceSchema.optional(),
})

export const updateWidgetRequestSchema = z
	.object({
		agentId: z.string().min(1).optional(),
		name: nameSchema.optional(),
		appearance: appearanceSchema.optional(),
	})
	.refine((patch) => Object.keys(patch).length > 0, { message: "Provide at least one field to update" })

export const widgetResponseSchema = z.object({ widget: widgetSchema })
export const widgetListResponseSchema = z.object({ widgets: z.array(widgetSchema) })

export const widgetConfigResponseSchema = z.object({
	version: z.number(),
	agentId: z.string(),
	appearance: widgetSchema.shape.appearance,
})
