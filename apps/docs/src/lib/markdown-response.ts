import { setResponseHeader } from "@tanstack/react-start/server"
import { isMarkdownPreferred } from "fumadocs-core/negotiation"

import { renderProblemsMarkdown } from "./problem-catalog"
import { isValidSlugPath } from "./slugs"
import { docsLlms, source } from "./source"

const MARKDOWN_HEADERS = { "Content-Type": "text/markdown; charset=utf-8" }

export async function markdownResponse(slugs: unknown): Promise<Response | null> {
	if (!isValidSlugPath(slugs)) return null

	if (slugs.length === 1 && slugs[0] === "problems") {
		return new Response(renderProblemsMarkdown(), { headers: MARKDOWN_HEADERS })
	}

	const page = source.getPage(slugs)
	if (!page) return null

	return new Response(await docsLlms.page(page), { headers: MARKDOWN_HEADERS })
}

export async function negotiateMarkdown(request: Request, slugs: unknown): Promise<Response | null> {
	setResponseHeader("Vary", "Accept")
	if (!isMarkdownPreferred(request)) return null
	return markdownResponse(slugs)
}
