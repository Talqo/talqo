import { createGetUrl } from "fumadocs-core/source"

export const DOCS_ROUTE = "/"
const getDocsUrl = createGetUrl(DOCS_ROUTE)

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }): { segments: string[]; url: string } {
	const segments = [...page.slugs]
	if (segments.length === 0) {
		segments.push("index.md")
	} else {
		segments[segments.length - 1] += ".md"
	}

	return { segments, url: getDocsUrl(segments, page.locale) }
}

export function decodeMarkdownUrl(segments: string[]): string[] {
	if (segments.length === 0) return []

	const out = [...segments]
	const lastIndex = out.length - 1
	const last = out[lastIndex]
	if (last !== undefined) out[lastIndex] = last.replace(/\.md$/, "")
	if (out.length === 1 && out[0] === "index") out.pop()
	return out
}
