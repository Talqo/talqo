import type { WidgetAppearanceInput } from "@talqo/shared/widget-appearance"

import { WIDGET_CONFIG_VERSION } from "@talqo/shared/widget-appearance"

/**
 * Per-page escape hatch, unvalidated and winning over the fetched configuration.
 * The dashboard no longer emits these: a baked-in color pins the embed to a stale palette.
 */
export function appearanceFromDataset(dataset: DOMStringMap | undefined): WidgetAppearanceInput {
	if (!dataset) {
		return {}
	}
	const overrides: Record<string, unknown> = {
		// `data-talqo-accent` predates the four-color palette and still maps to primary.
		primary: dataset.talqoPrimary ?? dataset.talqoAccent,
		primaryForeground: dataset.talqoPrimaryForeground,
		background: dataset.talqoBackground,
		foreground: dataset.talqoForeground,
		position: dataset.talqoPosition,
		theme: dataset.talqoTheme,
		language: dataset.talqoLanguage,
		themeToggle: parseBoolean(dataset.talqoThemeToggle),
	}
	return Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined))
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

export function configUrl(origin: string, publicToken: string): string {
	return `${origin}/api/widget-config/${encodeURIComponent(publicToken)}`
}

/** Unknown shapes yield no overrides, so a misbehaving endpoint degrades the widget to its defaults. */
export function parseWidgetConfig(payload: unknown): { agentId?: string; appearance: WidgetAppearanceInput } {
	if (typeof payload !== "object" || payload === null) {
		return { appearance: {} }
	}
	const body = payload as { agentId?: unknown; appearance?: unknown; version?: unknown }
	if (
		body.version !== WIDGET_CONFIG_VERSION ||
		typeof body.appearance !== "object" ||
		body.appearance === null ||
		Array.isArray(body.appearance)
	) {
		return { appearance: {} }
	}
	return {
		agentId: typeof body.agentId === "string" ? body.agentId : undefined,
		appearance: body.appearance as WidgetAppearanceInput,
	}
}
