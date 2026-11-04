import { docsLlms } from "@/lib/source"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/llms.txt")({
	server: {
		handlers: {
			GET: async () => {
				const reference = [
					"## Reference",
					"",
					"- [API problem types](/problems): RFC 9457 problem codes and recovery guidance.",
					"- [MCP endpoint](/api/mcp): read-only tools for listing, reading, and searching these pages.",
				].join("\n")

				return new Response(`${await docsLlms.index()}\n\n${reference}\n`, {
					headers: { "Content-Type": "text/plain; charset=utf-8" },
				})
			},
		},
	},
})
