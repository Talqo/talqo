export type EmbedPosition = "bottom-right" | "bottom-left"

export type EmbedConfig = {
	botId: string
	accent?: string
	language?: string
	position?: EmbedPosition
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

// The repo does not host a public CDN origin, so the dashboard must be told
// where widget.js is served (scripts/dev.ts points this at the widget dev
// server; deployments set their own origin). Without it no snippet is shown.
export function widgetScriptUrl(): string | undefined {
	return import.meta.env.VITE_WIDGET_CDN_URL as string | undefined
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}

// No defer/async in the emitted snippet: document.currentScript is how the
// bundle reads its own data-talqo-* configuration (see apps/widget/src/widget.tsx).
export function buildEmbedSnippet(scriptUrl: string, config: EmbedConfig): string {
	const attributes = [
		`src="${escapeAttribute(scriptUrl)}"`,
		`data-talqo-bot="${escapeAttribute(config.botId)}"`,
		config.accent && HEX_COLOR.test(config.accent) ? `data-talqo-accent="${config.accent}"` : undefined,
		config.language ? `data-talqo-language="${escapeAttribute(config.language)}"` : undefined,
		config.position ? `data-talqo-position="${config.position}"` : undefined,
	].filter((attribute): attribute is string => typeof attribute === "string")
	return ["<script", ...attributes.map((attribute) => `  ${attribute}`), "></script>"].join("\n")
}
