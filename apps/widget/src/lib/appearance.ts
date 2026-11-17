import { isSupportedLanguage } from "@talqo/shared"
import {
	DEFAULT_WIDGET_APPEARANCE,
	isHexColor,
	isWidgetPosition,
	isWidgetTheme,
	type WidgetAppearance,
	type WidgetAppearanceInput,
	type WidgetScheme,
	type WidgetSchemeInput,
} from "@talqo/shared/widget-appearance"

const SCHEME_KEYS = ["primary", "textOnPrimary", "background", "surface", "text"] as const

function resolveScheme(input: WidgetSchemeInput | undefined, fallback: WidgetScheme): WidgetScheme {
	const scheme = { ...fallback }
	for (const key of SCHEME_KEYS) {
		const color = input?.[key]
		if (isHexColor(color)) scheme[key] = color
	}
	return scheme
}

function pick<T>(value: unknown, guard: (candidate: unknown) => candidate is T, fallback: T): T {
	return guard(value) ? value : fallback
}

/** Per-field fallback: one invalid hex in a `var()` blanks every declaration that uses it. */
export function resolveAppearance(appearance: WidgetAppearanceInput | undefined): WidgetAppearance {
	return {
		light: resolveScheme(appearance?.light, DEFAULT_WIDGET_APPEARANCE.light),
		dark: resolveScheme(appearance?.dark, DEFAULT_WIDGET_APPEARANCE.dark),
		position: pick(appearance?.position, isWidgetPosition, DEFAULT_WIDGET_APPEARANCE.position),
		theme: pick(appearance?.theme, isWidgetTheme, DEFAULT_WIDGET_APPEARANCE.theme),
		themeToggle: pick(
			appearance?.themeToggle,
			(value): value is boolean => typeof value === "boolean",
			DEFAULT_WIDGET_APPEARANCE.themeToggle,
		),
		language: pick(appearance?.language, isSupportedLanguage, DEFAULT_WIDGET_APPEARANCE.language),
	}
}

export function activeScheme(appearance: WidgetAppearance, prefersDark: boolean): WidgetScheme {
	if (appearance.theme === "system") return prefersDark ? appearance.dark : appearance.light
	return appearance.theme === "dark" ? appearance.dark : appearance.light
}
