import { decodeMarkdownUrl } from "@/lib/markdown"
import { markdownResponse } from "@/lib/markdown-response"
import { createFileRoute, notFound } from "@tanstack/react-router"

export async function getMarkdown({ params }: { params: { _splat?: string } }): Promise<Response> {
	// oxlint-disable-next-line no-underscore-dangle -- TanStack Router names the splat param `_splat`.
	const slugs = decodeMarkdownUrl(params._splat?.split("/") ?? [])
	const response = await markdownResponse(slugs)
	if (!response) throw notFound()
	return response
}

export const Route = createFileRoute("/{$}.md")({
	server: { handlers: { GET: getMarkdown } },
})
