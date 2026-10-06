import { db } from "@/db/client.ts"

import { mcpServer } from "./mcp.schema.ts"

const SEED_AGENT_ID = "11111111-1111-4111-8111-111111111111"
const SEED_STDIO_SERVER_ID = "44444444-4444-4444-8444-444444444444"
const SEED_HTTP_SERVER_ID = "55555555-5555-5555-8555-555555555555"

/** The demo stdio server ships with the repo, so this connection works with no extra setup. */
const DEMO_STDIO_SCRIPT = "test-fixtures/mcp-demo-server.ts"

const DEMO_TOOLS = [
	{ name: "get_stock_level", description: "How many units of a product are in stock, by SKU.", selected: true },
	{ name: "list_orders", description: "Recent orders, optionally filtered by status.", selected: true },
	{
		name: "report_environment",
		description: "Reports the environment variables this server can see.",
		selected: false,
	},
]

// Deliberately nothing is listening here. The pair seeds one connection that works and one that does
// not, so both the working card and the failed one are visible without extra infrastructure.
const DEMO_HTTP_URL = "http://127.0.0.1:8092/mcp"

export async function seed(): Promise<void> {
	const rows = [
		{
			id: SEED_STDIO_SERVER_ID,
			agentId: SEED_AGENT_ID,
			name: "Shop inventory",
			transport: "stdio" as const,
			url: null,
			authMode: null,
			headers: null,
			command: "bun",
			args: [DEMO_STDIO_SCRIPT],
			env: {},
			tools: DEMO_TOOLS,
		},
		{
			id: SEED_HTTP_SERVER_ID,
			agentId: SEED_AGENT_ID,
			name: "Warehouse API",
			transport: "http" as const,
			url: DEMO_HTTP_URL,
			authMode: "none" as const,
			headers: null,
			command: null,
			args: [],
			env: {},
			// No tools, so it reads as not working, which is what it is.
			tools: [],
		},
	]

	await Promise.all(
		rows.map((values) => {
			const updates = { ...values, id: undefined }
			return db
				.insert(mcpServer)
				.values(values)
				.onConflictDoUpdate({ target: mcpServer.id, set: { ...updates, updatedAt: new Date() } })
		}),
	)
}
