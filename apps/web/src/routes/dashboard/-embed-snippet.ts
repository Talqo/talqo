export type EmbedPosition = "bottom-right" | "bottom-left"

export type EmbedConfig = {
	embedToken: string
	accent?: string
	language?: string
	position?: EmbedPosition
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export function widgetScriptUrl(): string | undefined {
	return import.meta.env.VITE_WIDGET_CDN_URL as string | undefined
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}

export function buildEmbedSnippet(scriptUrl: string, config: EmbedConfig): string {
	const attributes = [
		`src="${escapeAttribute(scriptUrl)}"`,
		`data-talqo-embed-token="${escapeAttribute(config.embedToken)}"`,
		config.accent && HEX_COLOR.test(config.accent) ? `data-talqo-accent="${config.accent}"` : undefined,
		config.language ? `data-talqo-language="${escapeAttribute(config.language)}"` : undefined,
		config.position ? `data-talqo-position="${config.position}"` : undefined,
	].filter((attribute): attribute is string => typeof attribute === "string")
	return ["<script", ...attributes.map((attribute) => `  ${attribute}`), "></script>"].join("\n")
}
