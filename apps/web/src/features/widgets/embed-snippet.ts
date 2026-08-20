export type EmbedConfig = {
	/** Emitted only when the API is not served from the widget script's own origin. */
	apiOrigin?: string
	publicToken: string
}

export function widgetScriptUrl(): string | undefined {
	return import.meta.env.VITE_WIDGET_CDN_URL as string | undefined
}

/** The snippet is rendered for copy-paste into a host page, so it must survive as literal text. */
function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * Carries identity only, never appearance. A baked-in color would pin the embed to
 * whatever the palette was on the day it was copied, and the operator would have to
 * re-paste the snippet on every visual change -- the opposite of fetching by token.
 */
export function buildEmbedSnippet(scriptUrl: string, config: EmbedConfig): string {
	const attributes = [
		`src="${escapeAttribute(scriptUrl)}"`,
		`data-talqo-widget="${escapeAttribute(config.publicToken)}"`,
		config.apiOrigin ? `data-talqo-api="${escapeAttribute(config.apiOrigin)}"` : undefined,
	].filter((attribute): attribute is string => typeof attribute === "string")
	return ["<script", ...attributes.map((attribute) => `  ${attribute}`), "></script>"].join("\n")
}

/**
 * The widget defaults to its own script origin, so the attribute is only needed when
 * the dashboard knows the API lives elsewhere.
 */
export function apiOriginOverride(scriptUrl: string, apiOrigin: string | undefined): string | undefined {
	if (!apiOrigin) {
		return undefined
	}
	try {
		return new URL(scriptUrl).origin === new URL(apiOrigin).origin ? undefined : new URL(apiOrigin).origin
	} catch {
		return undefined
	}
}
