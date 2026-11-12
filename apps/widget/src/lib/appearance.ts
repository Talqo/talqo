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

function resolveScheme(input: WidgetSchemeInput | undefined, fallback: WidgetScheme): WidgetScheme {
	return {
		primary: isHexColor(input?.primary) ? input.primary : fallback.primary,
		textOnPrimary: isHexColor(input?.textOnPrimary) ? input.textOnPrimary : fallback.textOnPrimary,
		background: isHexColor(input?.background) ? input.background : fallback.background,
		surface: isHexColor(input?.surface) ? input.surface : fallback.surface,
		text: isHexColor(input?.text) ? input.text : fallback.text,
	}
}

/** Per-field fallback: one invalid hex in a `var()` blanks every declaration that uses it. */
export function resolveAppearance(appearance: WidgetAppearanceInput | undefined): WidgetAppearance {
	return {
		light: resolveScheme(appearance?.light, DEFAULT_WIDGET_APPEARANCE.light),
		dark: resolveScheme(appearance?.dark, DEFAULT_WIDGET_APPEARANCE.dark),
		position: isWidgetPosition(appearance?.position) ? appearance.position : DEFAULT_WIDGET_APPEARANCE.position,
		theme: isWidgetTheme(appearance?.theme) ? appearance.theme : DEFAULT_WIDGET_APPEARANCE.theme,
		themeToggle:
			typeof appearance?.themeToggle === "boolean" ? appearance.themeToggle : DEFAULT_WIDGET_APPEARANCE.themeToggle,
		language: isSupportedLanguage(appearance?.language) ? appearance.language : DEFAULT_WIDGET_APPEARANCE.language,
	}
}

export function activeScheme(appearance: WidgetAppearance, prefersDark: boolean): WidgetScheme {
	if (appearance.theme === "system") return prefersDark ? appearance.dark : appearance.light
	return appearance.theme === "dark" ? appearance.dark : appearance.light
}
