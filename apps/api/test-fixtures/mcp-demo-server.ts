/**
 * Demo MCP server for the Talqo dev stack and integration tests. Speaks the wire protocol directly so
 * the repository keeps a single MCP stack: @ai-sdk/mcp is the client, this is the other end of it.
 *
 * Run as `bun test-fixtures/mcp-demo-server.ts`.
 */
const PROTOCOL_FALLBACK = "2025-06-18"
const SERVER_INFO = { name: "talqo-demo-server", version: "1.0.0" }

const CATALOGUE = [
	{ sku: "TALQO-TEA-001", name: "Earl Grey, 100 bags", stock: 42 },
	{ sku: "TALQO-TEA-002", name: "Jasmine, 100 bags", stock: 0 },
	{ sku: "TALQO-MUG-001", name: "Talqo mug", stock: 7 },
]

const ORDERS = [
	{ id: "A-1001", status: "shipped", totalCents: 2580 },
	{ id: "A-1002", status: "awaiting_payment", totalCents: 1290 },
]

const TOOLS = [
	{
		name: "get_stock_level",
		description: "How many units of a product are in stock, by SKU.",
		inputSchema: {
			type: "object",
			properties: { sku: { type: "string", description: "Product SKU, for example TALQO-TEA-001" } },
			required: ["sku"],
		},
	},
	{
		name: "list_orders",
		description: "Recent orders, optionally filtered by status.",
		inputSchema: {
			type: "object",
			properties: { status: { type: "string", description: "One of shipped or awaiting_payment" } },
		},
	},
	{
		name: "report_environment",
		description: "Reports this server\u2019s process id and the environment variables it can see.",
		inputSchema: { type: "object", properties: {} },
	},
]

type JsonRpc = { id?: number | string; method: string; params?: Record<string, unknown> }

function text(value: unknown) {
	return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] }
}

function callTool(name: string, args: Record<string, unknown>) {
	if (name === "get_stock_level") {
		const product = CATALOGUE.find((entry) => entry.sku === args.sku)
		if (!product) return { content: [{ type: "text", text: `No product with SKU ${String(args.sku)}` }], isError: true }
		return text({ sku: product.sku, name: product.name, inStock: product.stock })
	}
	if (name === "list_orders") {
		const status = args.status
		const orders = typeof status === "string" ? ORDERS.filter((order) => order.status === status) : ORDERS
		return text({ orders })
	}
	if (name === "report_environment") {
		// Deliberately reports everything: the test asserts Talqo's own secrets are absent.
		// The pid lets a test confirm the process really was stopped, rather than inferring it.
		return text({ pid: process.pid, env: Object.fromEntries(Object.entries(process.env).toSorted()) })
	}
	return { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true }
}

/** Returns a JSON-RPC response, or undefined for notifications that get no reply. */
function handle(message: JsonRpc): JsonRpc | undefined {
	const id = message.id
	if (message.method === "initialize") {
		const requested = (message.params as { protocolVersion?: string } | undefined)?.protocolVersion
		return {
			jsonrpc: "2.0",
			id,
			result: {
				// Echoing the client's version keeps every era the client supports working.
				protocolVersion: requested ?? PROTOCOL_FALLBACK,
				capabilities: { tools: {} },
				serverInfo: SERVER_INFO,
			},
		}
	}
	if (message.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } }
	if (message.method === "tools/call") {
		const { name, arguments: args } = message.params as { name: string; arguments?: Record<string, unknown> }
		return { jsonrpc: "2.0", id, result: callTool(name, args ?? {}) }
	}
	if (message.method === "ping") return { jsonrpc: "2.0", id, result: {} }
	if (id === undefined) return undefined
	return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } }
}

function serveStdio(): void {
	let buffer = ""
	process.stdin.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf8")
		for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
			const line = buffer.slice(0, newline).trim()
			buffer = buffer.slice(newline + 1)
			if (!line) continue
			const response = handle(JSON.parse(line) as JsonRpc)
			if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
		}
	})
	// The client closes stdin to shut the process down.
	process.stdin.on("end", () => process.exit(0))
}

if (import.meta.main) serveStdio()
