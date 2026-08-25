import type { Widget } from "@/api/generated/models/widget/widget.zod.ts"

import { isSupportedLanguage, SUPPORTED_LANGUAGES } from "@talqo/shared/languages"
import {
	DEFAULT_WIDGET_APPEARANCE,
	WIDGET_POSITIONS,
	WIDGET_THEMES,
	type WidgetAppearance,
} from "@talqo/shared/widget-appearance"
import { z } from "zod"

// Mirrors apps/api/src/modules/widget/widget.contract.ts. Kept separate on purpose:
// the API's job is to reject, this one's is to guide the operator while they type.
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color, e.g. #1a7f4b")

export const widgetFormSchema = z.object({
	name: z.string().trim().min(1),
	agentId: z.string().min(1),
	primary: colorSchema,
	primaryForeground: colorSchema,
	background: colorSchema,
	foreground: colorSchema,
	position: z.enum(WIDGET_POSITIONS),
	theme: z.enum(WIDGET_THEMES),
	themeToggle: z.boolean(),
	language: z.enum(SUPPORTED_LANGUAGES),
})

export type WidgetFormValues = z.infer<typeof widgetFormSchema>

export const WIDGET_FORM_DEFAULTS: Omit<WidgetFormValues, "agentId" | "name"> = {
	primary: DEFAULT_WIDGET_APPEARANCE.primary,
	primaryForeground: DEFAULT_WIDGET_APPEARANCE.primaryForeground,
	background: DEFAULT_WIDGET_APPEARANCE.background,
	foreground: DEFAULT_WIDGET_APPEARANCE.foreground,
	position: DEFAULT_WIDGET_APPEARANCE.position,
	theme: DEFAULT_WIDGET_APPEARANCE.theme,
	themeToggle: DEFAULT_WIDGET_APPEARANCE.themeToggle,
	language: DEFAULT_WIDGET_APPEARANCE.language,
}

/** The form is flat so each color is its own field; the API takes a nested object. */
export function toAppearance(values: WidgetFormValues): WidgetAppearance {
	return {
		primary: values.primary,
		primaryForeground: values.primaryForeground,
		background: values.background,
		foreground: values.foreground,
		position: values.position,
		theme: values.theme,
		themeToggle: values.themeToggle,
		language: values.language as WidgetAppearance["language"],
	}
}

export function toFormValues(widget: Pick<Widget, "agentId" | "appearance" | "name">): WidgetFormValues {
	const { language, ...appearance } = widget.appearance
	return {
		name: widget.name,
		agentId: widget.agentId,
		...appearance,
		// The API widens `language` on read, so a widget saved under a language since
		// dropped from `@talqo/shared` still opens -- on the default rather than a blank select.
		language: isSupportedLanguage(language) ? language : DEFAULT_WIDGET_APPEARANCE.language,
	}
}
