import type { WidgetAppearanceInput } from "@talqo/shared/widget-appearance"

import { WIDGET_CONFIG_VERSION } from "@talqo/shared/widget-appearance"

/**
 * Appearance overrides read from the embed script's `data-talqo-*` attributes.
 *
 * The dashboard no longer generates these -- a baked-in color would pin the widget
 * to a stale palette after the operator changes it. They remain a documented escape
 * hatch for hosts that need a per-page override, and therefore win over the fetched
 * configuration. Values are returned unvalidated; `resolveAppearance` decides which
 * ones survive.
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

/**
 * The widget defaults to the origin its own script came from -- in a standard
 * self-hosted deployment the API and widget.js share one, so the snippet needs no
 * extra attribute and there is no stale-origin footgun. `data-talqo-api` overrides
 * it for split deployments.
 */
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

/**
 * Reads the appearance out of a config response. Unknown shapes yield no overrides
 * rather than throwing, so a widget on a customer page degrades to its defaults
 * instead of disappearing when the endpoint misbehaves.
 */
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
