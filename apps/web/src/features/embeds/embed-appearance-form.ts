import type { Embed } from "@/api/generated/models/embed/embed.zod.ts"

import { isSupportedLanguage, SUPPORTED_LANGUAGES } from "@talqo/shared/languages"
import {
	DEFAULT_WIDGET_APPEARANCE,
	HEX_COLOR_MESSAGE,
	HEX_COLOR_PATTERN,
	WIDGET_POSITIONS,
	WIDGET_THEMES,
	type WidgetAppearance,
	type WidgetScheme,
} from "@talqo/shared/widget-appearance"
import { z } from "zod"

// Same source as the API contract, so guidance while typing cannot disagree with the reject.
const colorSchema = z.string().regex(HEX_COLOR_PATTERN, HEX_COLOR_MESSAGE)

const schemeSchema = z.object({
	primary: colorSchema,
	textOnPrimary: colorSchema,
	background: colorSchema,
	surface: colorSchema,
	text: colorSchema,
})

export const embedFormSchema = z.object({
	name: z.string().trim().min(1),
	agentId: z.string().min(1),
	light: schemeSchema,
	dark: schemeSchema,
	position: z.enum(WIDGET_POSITIONS),
	theme: z.enum(WIDGET_THEMES),
	themeToggle: z.boolean(),
	language: z.enum(SUPPORTED_LANGUAGES),
})

export type EmbedFormValues = z.infer<typeof embedFormSchema>
type WidgetSchemeFormValues = z.infer<typeof schemeSchema>

export const EMBED_FORM_DEFAULTS: Omit<EmbedFormValues, "agentId" | "name"> = {
	light: DEFAULT_WIDGET_APPEARANCE.light,
	dark: DEFAULT_WIDGET_APPEARANCE.dark,
	position: DEFAULT_WIDGET_APPEARANCE.position,
	theme: DEFAULT_WIDGET_APPEARANCE.theme,
	themeToggle: DEFAULT_WIDGET_APPEARANCE.themeToggle,
	language: DEFAULT_WIDGET_APPEARANCE.language,
}

/** The form is flat under each scheme; the API takes a nested appearance object. */
export function toAppearance(values: EmbedFormValues): WidgetAppearance {
	return {
		light: values.light,
		dark: values.dark,
		position: values.position,
		theme: values.theme,
		themeToggle: values.themeToggle,
		language: values.language as WidgetAppearance["language"],
	}
}

function toSchemeFormValues(scheme: WidgetScheme): WidgetSchemeFormValues {
	return {
		primary: scheme.primary,
		textOnPrimary: scheme.textOnPrimary,
		background: scheme.background,
		surface: scheme.surface,
		text: scheme.text,
	}
}

export function toFormValues(embed: Pick<Embed, "agentId" | "appearance" | "name">): EmbedFormValues {
	const { language, light, dark } = embed.appearance
	return {
		name: embed.name,
		agentId: embed.agentId,
		light: toSchemeFormValues(light),
		dark: toSchemeFormValues(dark),
		position: embed.appearance.position,
		theme: embed.appearance.theme,
		themeToggle: embed.appearance.themeToggle,
		// The API widens `language` on read, so a since-dropped one opens on the default.
		language: isSupportedLanguage(language) ? language : DEFAULT_WIDGET_APPEARANCE.language,
	}
}
