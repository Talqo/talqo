import { search } from "@/lib/search"
import { docsLlms, source } from "@/lib/source"
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"
import { createFileRoute } from "@tanstack/react-router"
import { registerSearchTool, registerSourceTools } from "fumadocs-core/mcp"

const handler = createMcpHandler(() => {
	const mcp = new McpServer({ name: "talqo-docs", version: "1.0.0" })
	registerSourceTools(mcp, source, docsLlms)
	registerSearchTool(mcp, search)
	return mcp
})

export const Route = createFileRoute("/api/mcp")({
	server: {
		handlers: {
			GET: ({ request }) => handler.fetch(request),
			POST: ({ request }) => handler.fetch(request),
			DELETE: ({ request }) => handler.fetch(request),
		},
	},
})
