import type { WidgetAppearanceInput, WidgetSchemeInput } from "@talqo/shared/widget-appearance"

function definedEntries(overrides: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined))
}

function schemeFromValues(
	get: (key: string) => string | undefined,
	prefix: "light" | "dark",
): WidgetSchemeInput | undefined {
	const scheme = definedEntries({
		primary: get(`${prefix}Primary`),
		textOnPrimary: get(`${prefix}TextOnPrimary`),
		background: get(`${prefix}Background`),
		surface: get(`${prefix}Surface`),
		text: get(`${prefix}Text`),
	})
	return Object.keys(scheme).length > 0 ? scheme : undefined
}

export function appearanceFromValues(get: (key: string) => string | undefined): WidgetAppearanceInput {
	return definedEntries({
		light: schemeFromValues(get, "light"),
		dark: schemeFromValues(get, "dark"),
		position: get("position"),
		theme: get("theme"),
		language: get("language"),
		themeToggle: parseBoolean(get("themeToggle")),
	})
}

/**
 * Per-page escape hatch, unvalidated and winning over the fetched configuration.
 * The dashboard no longer emits these: a baked-in color pins the embed to a stale palette.
 */
export function appearanceFromDataset(dataset: DOMStringMap | undefined): WidgetAppearanceInput {
	return appearanceFromValues((key) => dataset?.[`talqo${key[0]?.toUpperCase()}${key.slice(1)}`])
}

/** Attributes last: a per-page override outranks the stored config, one color at a time. */
export function mergeAppearance(
	config: WidgetAppearanceInput,
	overrides: WidgetAppearanceInput,
): WidgetAppearanceInput {
	return {
		...config,
		...overrides,
		light: { ...config.light, ...overrides.light },
		dark: { ...config.dark, ...overrides.dark },
	}
}

function parseBoolean(value: string | undefined): boolean | undefined {
	if (value === "true") {
		return true
	}
	if (value === "false") {
		return false
	}
	return undefined
}

/** Defaults to the script's own origin, which self-hosted deployments share with the API. */
export function apiOrigin(script: HTMLScriptElement | null): string | undefined {
	const override = script?.dataset.talqoApi
	if (override) {
		try {
			return new URL(override).origin
		} catch {
			console.warn("TalqoWidget: data-talqo-api is not a valid URL; falling back to the script origin")
		}
	}
	try {
		return script?.src ? new URL(script.src).origin : undefined
	} catch {
		return undefined
	}
}
