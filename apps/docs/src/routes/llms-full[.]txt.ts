import { renderProblemsMarkdown } from "@/lib/problem-catalog"
import { docsLlms } from "@/lib/source"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/llms-full.txt")({
	server: {
		handlers: {
			GET: async () => {
				const body = `${await docsLlms.full()}\n\n---\n\n${renderProblemsMarkdown()}`

				return new Response(body, {
					headers: { "Content-Type": "text/plain; charset=utf-8" },
				})
			},
		},
	},
})
