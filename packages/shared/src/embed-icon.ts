const BYTES_PER_KB = 1024
/** Shared by the API reject and the dashboard pre-check so both name the same limit. */
export const EMBED_ICON_MAX_KB = 64
export const EMBED_ICON_MAX_BYTES = EMBED_ICON_MAX_KB * BYTES_PER_KB

// Prolog the root <svg> may follow: BOM, XML declaration, comments, processing instructions, whitespace.
const PROLOG = /^(?:\uFEFF|\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->)*/
const SVG_ROOT = /^<svg[\s>]/
const SVG_END = /<\/svg>\s*$/
// Entity declarations only expand in a DTD; rejecting one rules out entity-expansion tricks.
const DTD = /<!DOCTYPE|<!ENTITY/i

/**
 * Structural check only: it does not make the markup safe. Safety comes from rendering icons only
 * through `<img>` and serving them with a sandboxing CSP, so SVG scripts never run.
 */
export function isSvgDocument(markup: string): boolean {
	const body = markup.replace(PROLOG, "")
	return SVG_ROOT.test(body) && SVG_END.test(body) && !DTD.test(markup)
}

/** Saved icons load from the API over HTTP(S); an unsaved dashboard draft is an SVG data URL. */
export function isIconUrl(value: unknown): value is string {
	if (typeof value !== "string") return false
	if (value.startsWith(SVG_DATA_URL_PREFIX)) return true
	try {
		const { protocol } = new URL(value)
		return protocol === "https:" || protocol === "http:"
	} catch {
		return false
	}
}

const SVG_DATA_URL_PREFIX = "data:image/svg+xml,"

/** Renders a picked icon before it is saved; consumers show it only through `<img>`, like a saved one. */
export function svgDataUrl(markup: string): string {
	return SVG_DATA_URL_PREFIX + encodeURIComponent(markup)
}
