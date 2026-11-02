import { decodeMarkdownUrl } from "@/lib/markdown"
import { markdownResponse } from "@/lib/markdown-response"
import { createFileRoute, notFound } from "@tanstack/react-router"

export const Route = createFileRoute("/{$}.md")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				// oxlint-disable-next-line no-underscore-dangle -- TanStack Router names the splat param `_splat`.
				const slugs = decodeMarkdownUrl(params._splat?.split("/") ?? [])
				const response = await markdownResponse(slugs)
				if (!response) throw notFound()
				return response
			},
		},
	},
})
