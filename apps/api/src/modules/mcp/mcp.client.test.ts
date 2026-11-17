import type { CredentialEnvelope } from "@/lib/credential-vault.ts"
import type { ListToolsResult, MCPClient, MCPClientConfig } from "@ai-sdk/mcp"

import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio"
import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { McpServerRow } from "./mcp.schema.ts"

import { MAX_STDIO_CONNECT_MS, MAX_TOOL_DESCRIPTION_CHARACTERS, MAX_TOOL_RESULT_CHARACTERS } from "./mcp.types.ts"

type ListedTool = ListToolsResult["tools"][number]
type Behavior = {
	connectError?: Error
	closeCalls: number
	execute?: (toolName: string) => unknown
	listCalls: { cursor?: string }[]
	listError?: Error
	pages?: ListToolsResult[]
}

const behaviors = new Map<string, Behavior>()
const connections: MCPClientConfig[] = []
await mock.module("@ai-sdk/mcp", () => ({
	createMCPClient: async (config: MCPClientConfig) => {
		connections.push(config)
		const behavior = behaviors.get(transportUrl(config))
		if (!behavior) throw new Error(`Unexpected MCP connection to ${transportUrl(config)}`)
		if (behavior.connectError) throw behavior.connectError
		return {
			listTools: async (options?: { params?: { cursor?: string } }) => {
				behavior.listCalls.push({ cursor: options?.params?.cursor })
				if (behavior.listError) throw behavior.listError
				const index = options?.params?.cursor ? Number(options.params.cursor) : 0
				return behavior.pages?.[index] ?? { tools: [] }
			},
			toolsFromDefinitions: ({ tools }: { tools: ListedTool[] }) =>
				Object.fromEntries(
					tools.map((tool) => [
						tool.name,
						{
							description: tool.description,
							execute: async () => behavior.execute?.(tool.name) ?? "ran",
						},
					]),
				),
			close: async () => {
				behavior.closeCalls += 1
			},
		} as unknown as MCPClient
	},
}))

const { discoverTools, namespaceToolName, openTools, TOOL_NAME_MAX_LENGTH, truncateResult, withListTimeout } =
	await import("./mcp.client.ts")

beforeEach(() => {
	behaviors.clear()
	connections.length = 0
})

function transportUrl(config: MCPClientConfig) {
	return (config.transport as { url?: string }).url ?? "stdio"
}

function behaviorFor(url: string, behavior: Partial<Behavior> = {}): Behavior {
	const complete: Behavior = { closeCalls: 0, listCalls: [], ...behavior }
	behaviors.set(url, complete)
	return complete
}

function serverRow(overrides: Partial<McpServerRow> & { name: string }): McpServerRow {
	return {
		id: overrides.name,
		agentId: "agent",
		transport: "http",
		url: null,
		authMode: "none",
		headers: null,
		command: null,
		args: [],
		env: {},
		tools: [],
		isDisabled: false,
		revision: 1,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...overrides,
	}
}

function stdioRow(name = "Local"): McpServerRow {
	return serverRow({
		name,
		transport: "stdio",
		command: "npx",
		args: ["server"],
		authMode: null,
		tools: [{ name: "lookup", description: "", enabled: true }],
	})
}

const vault = {
	decrypt: (envelope: CredentialEnvelope) => envelope.ciphertext,
} as unknown as Parameters<typeof openTools>[1]["vault"]

const options = { vault, onDegraded: () => undefined }

describe("namespaceToolName", () => {
	it("keeps two servers offering the same tool name apart", () => {
		expect(namespaceToolName("Shopify", "get_product")).toBe("Shopify__get_product")
		expect(namespaceToolName("Warehouse", "get_product")).toBe("Warehouse__get_product")
	})

	it("replaces characters a provider tool-name grammar forbids", () => {
		expect(namespaceToolName("my server", "shopify.get/v1")).toBe("my_server__shopify_get_v1")
	})

	it("keeps the whole name within the provider limit, hash included", () => {
		const name = namespaceToolName("s".repeat(40), "t".repeat(40))

		expect(name.length).toBeLessThanOrEqual(TOOL_NAME_MAX_LENGTH)
		expect(name).toContain("_")
	})

	it("gives two long names that share a prefix distinct keys", () => {
		const first = namespaceToolName("s".repeat(40), `${"t".repeat(40)}a`)
		const second = namespaceToolName("s".repeat(40), `${"t".repeat(40)}b`)

		expect(first).not.toBe(second)
	})

	it("leaves a name that exactly fits the provider limit untouched", () => {
		const server = "s".repeat(32)
		const tool = "t".repeat(30)
		const name = namespaceToolName(server, tool)

		expect(name).toHaveLength(TOOL_NAME_MAX_LENGTH)
		expect(name).toBe(`${server}__${tool}`)
	})
})

describe("truncateResult", () => {
	it("passes small mixed results through untouched", () => {
		const result = {
			content: [
				{ type: "text", text: "ok" },
				{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
			],
		}
		expect(truncateResult(result)).toEqual(result)
	})

	it("drops a hostile image blob but keeps the small parts", () => {
		const out = truncateResult({
			content: [
				{ type: "text", text: "seen" },
				{ type: "image", data: "x".repeat(20_000), mimeType: "image/png" },
			],
		}) as { content: unknown[] }
		expect(out.content).toHaveLength(2)
		expect(out.content[0]).toEqual({ type: "text", text: "seen" })
		expect(out.content[1]).toEqual({ type: "text", text: "…[truncated, the server returned more]" })
	})

	it("marks truncation once across several over-budget text parts", () => {
		// Every part shares one prod budget (MAX_TOOL_RESULT_CHARACTERS=8000 in mcp.types.ts).
		const overBudget = MAX_TOOL_RESULT_CHARACTERS + 1_000
		const out = truncateResult({
			content: [
				{ type: "text", text: "a".repeat(overBudget) },
				{ type: "text", text: "b".repeat(overBudget) },
			],
		}) as {
			content: { text: string }[]
		}
		const markers = out.content.filter((part) => part.text.includes("truncated")).length
		expect(markers).toBe(1)
		expect(JSON.stringify(out).length).toBeLessThan(MAX_TOOL_RESULT_CHARACTERS + 200)
	})

	it("truncates a plain string result at the shared budget", () => {
		const text = "a".repeat(MAX_TOOL_RESULT_CHARACTERS + 10)
		const out = truncateResult(text) as string

		expect(out.slice(0, MAX_TOOL_RESULT_CHARACTERS)).toBe("a".repeat(MAX_TOOL_RESULT_CHARACTERS))
		expect(out).toContain("truncated")
	})

	it("keeps a string that exactly fits the budget", () => {
		const text = "a".repeat(MAX_TOOL_RESULT_CHARACTERS)

		expect(truncateResult(text)).toBe(text)
	})

	it.each([null, 42, { content: "not an array" }, { content: undefined }])(
		"passes a result without a content array through: %p",
		(value) => {
			expect(truncateResult(value)).toBe(value)
		},
	)

	it("keeps text parts that exactly fit the budget and truncates the next one", () => {
		const first = "a".repeat(MAX_TOOL_RESULT_CHARACTERS)
		const out = truncateResult({
			content: [
				{ type: "text", text: first },
				{ type: "text", text: "b" },
			],
		}) as { content: { text: string }[] }

		expect(out.content).toHaveLength(2)
		expect(out.content[0]?.text).toBe(first)
		expect(out.content[1]?.text).toContain("truncated")
	})

	it("charges non-text parts against the same budget", () => {
		const image = { type: "image", data: "x".repeat(100), mimeType: "image/png" }
		const text = "a".repeat(MAX_TOOL_RESULT_CHARACTERS - 10)
		const out = truncateResult({ content: [image, { type: "text", text }] }) as { content: { text: string }[] }

		expect(out.content[0] as unknown).toEqual(image)
		expect(out.content[1]?.text).toContain("truncated")
	})
})

describe("withListTimeout", () => {
	it("lets an already-resolved listing win over a later abort", async () => {
		const controller = new AbortController()
		const pending = withListTimeout(Promise.resolve("tools"), controller.signal)
		controller.abort(new Error("late abort"))
		await expect(pending).resolves.toBe("tools")
	})

	it("rejects a pending listing when the abort lands first", async () => {
		const controller = new AbortController()
		let rejectListing!: (error: unknown) => void
		const listing = new Promise<never>((_, reject) => {
			rejectListing = reject
		})
		const pending = withListTimeout(listing, controller.signal)
		controller.abort(new Error("early abort"))
		await expect(pending).rejects.toThrow("early abort")
		rejectListing(new Error("too late"))
		await expect(pending).rejects.toThrow("early abort")
	})

	it("rejects before waiting when the signal is already aborted", async () => {
		const reason = new Error("pre-aborted")

		await expect(withListTimeout(Promise.resolve("tools"), AbortSignal.abort(reason))).rejects.toBe(reason)
	})

	it("resolves without a signal", async () => {
		await expect(withListTimeout(Promise.resolve("tools"))).resolves.toBe("tools")
	})

	it("normalizes a non-Error rejection", async () => {
		await expect(withListTimeout(Promise.reject("boom"))).rejects.toThrow("MCP tool listing failed")
	})
})

describe("openTools", () => {
	it("resolves only enabled tools under namespaced names", async () => {
		const url = "https://shopify.test/mcp"
		const behavior = behaviorFor(url, {
			pages: [
				{
					tools: [
						{ name: "get_product", description: "Looks up a product", inputSchema: {} },
						{ name: "delete_product", description: "Deletes a product", inputSchema: {} },
					],
				},
			],
		})
		const degraded: string[] = []
		const row = serverRow({
			name: "Shopify",
			url,
			tools: [
				{ name: "get_product", description: "", enabled: true },
				{ name: "delete_product", description: "", enabled: false },
			],
		})

		const result = await openTools([row], { ...options, onDegraded: ({ name }) => degraded.push(name) })

		expect(Object.keys(result.tools)).toEqual(["Shopify__get_product"])
		expect(result.names.get("Shopify__get_product")).toEqual({ serverName: "Shopify", toolName: "get_product" })
		expect(degraded).toEqual([])
		expect(behavior.listCalls).toEqual([{ cursor: undefined }])
	})

	it("does not connect to a server with no enabled tools", async () => {
		const row = serverRow({
			name: "Idle",
			url: "https://idle.test/mcp",
			tools: [{ name: "x", description: "", enabled: false }],
		})

		const result = await openTools([row], options)

		expect(result.tools).toEqual({})
		expect(connections).toHaveLength(0)
	})

	it("keeps the first server when two sanitize to the same tool name", async () => {
		const first = "https://first.test/mcp"
		const second = "https://second.test/mcp"
		behaviorFor(first, { pages: [{ tools: [{ name: "lookup", inputSchema: {} }] }] })
		behaviorFor(second, { pages: [{ tools: [{ name: "lookup", inputSchema: {} }] }] })
		const degraded: { name: string; error: unknown }[] = []

		const result = await openTools(
			[
				serverRow({ name: "my server", url: first, tools: [{ name: "lookup", description: "", enabled: true }] }),
				serverRow({ name: "my_server", url: second, tools: [{ name: "lookup", description: "", enabled: true }] }),
			],
			{ ...options, onDegraded: (row, error) => degraded.push({ name: row.name, error }) },
		)

		expect(Object.keys(result.tools)).toEqual(["my_server__lookup"])
		expect(result.names.get("my_server__lookup")).toEqual({ serverName: "my server", toolName: "lookup" })
		expect(degraded).toHaveLength(1)
		expect(degraded[0]?.name).toBe("my_server")
		const error = degraded[0]?.error
		if (!(error instanceof Error)) throw new Error("Expected a degraded error")
		expect(error.message).toContain("already taken")
	})

	it("drops a failing server without losing the others", async () => {
		const broken = "https://broken.test/mcp"
		const working = "https://working.test/mcp"
		behaviorFor(broken, { connectError: new Error("connection refused") })
		behaviorFor(working, { pages: [{ tools: [{ name: "lookup", inputSchema: {} }] }] })
		const degraded: string[] = []

		const result = await openTools(
			[
				serverRow({ name: "Broken", url: broken, tools: [{ name: "lookup", description: "", enabled: true }] }),
				serverRow({ name: "Working", url: working, tools: [{ name: "lookup", description: "", enabled: true }] }),
			],
			{ ...options, onDegraded: (row) => degraded.push(row.name) },
		)

		expect(Object.keys(result.tools)).toEqual(["Working__lookup"])
		expect(degraded).toEqual(["Broken"])
	})

	it("bounds tool descriptions and results on the resolved tools", async () => {
		const url = "https://chatty.test/mcp"
		const description = "d".repeat(MAX_TOOL_DESCRIPTION_CHARACTERS + 50)
		const payload = "r".repeat(MAX_TOOL_RESULT_CHARACTERS + 50)
		behaviorFor(url, {
			execute: () => payload,
			pages: [{ tools: [{ name: "lookup", description, inputSchema: {} }] }],
		})
		const row = serverRow({ name: "Chatty", url, tools: [{ name: "lookup", description: "", enabled: true }] })

		const result = await openTools([row], options)
		const tool = result.tools["Chatty__lookup"]

		expect(tool?.description).toHaveLength(MAX_TOOL_DESCRIPTION_CHARACTERS)
		expect(await tool?.execute?.({} as never, { messages: [], toolCallId: "call-1" } as never)).toContain("truncated")
	})

	it("closes every connection exactly once", async () => {
		const url = "https://shopify.test/mcp"
		const behavior = behaviorFor(url, { pages: [{ tools: [{ name: "lookup", inputSchema: {} }] }] })
		const row = serverRow({ name: "Shopify", url, tools: [{ name: "lookup", description: "", enabled: true }] })

		const result = await openTools([row], options)
		await result.close()
		await result.close()

		expect(behavior.closeCalls).toBe(1)
	})

	it("decrypts stored headers for the header purpose and never follows redirects", async () => {
		const url = "https://shopify.test/mcp"
		behaviorFor(url, { pages: [{ tools: [{ name: "lookup", inputSchema: {} }] }] })
		const purposes: unknown[] = []
		const headerVault = {
			decrypt: (envelope: CredentialEnvelope, context: unknown) => {
				purposes.push(context)
				return envelope.ciphertext
			},
		} as unknown as typeof vault
		const row = serverRow({
			name: "Shopify",
			url,
			authMode: "headers",
			headers: { Authorization: { ciphertext: "Bearer stored", nonce: "", tag: "", version: 1 } },
			tools: [{ name: "lookup", description: "", enabled: true }],
		})

		await openTools([row], { ...options, vault: headerVault })

		expect(purposes).toEqual([{ serverId: "Shopify", purpose: "header" }])
		expect(connections[0]?.transport).toEqual({
			type: "http",
			url,
			headers: { Authorization: "Bearer stored" },
			redirect: "error",
		})
	})

	it("omits the headers key when a server stores none", async () => {
		const url = "https://open.test/mcp"
		behaviorFor(url, { pages: [{ tools: [{ name: "lookup", inputSchema: {} }] }] })
		const row = serverRow({ name: "Open", url, tools: [{ name: "lookup", description: "", enabled: true }] })

		await openTools([row], options)

		expect(connections[0]?.transport).toEqual({ type: "http", url, redirect: "error" })
	})

	it("bounds the connection timeout and disables retries", async () => {
		const url = "https://shopify.test/mcp"
		behaviorFor(url, { pages: [{ tools: [{ name: "lookup", inputSchema: {} }] }] })
		const controller = new AbortController()
		const row = serverRow({ name: "Shopify", url, tools: [{ name: "lookup", description: "", enabled: true }] })

		await openTools([row], { ...options, signal: controller.signal })

		expect(connections[0]).toMatchObject({
			initializationOptions: { signal: controller.signal, timeout: MAX_STDIO_CONNECT_MS },
			maxRetries: 0,
		})
	})

	it("connects to stdio servers when the deployment allows them", async () => {
		behaviorFor("stdio", { pages: [{ tools: [{ name: "lookup", inputSchema: {} }] }] })

		const result = await openTools([stdioRow()], options)

		expect(Object.keys(result.tools)).toEqual(["Local__lookup"])
		expect(connections[0]?.transport).toBeInstanceOf(Experimental_StdioMCPTransport)
	})

	it("refuses stdio servers when the deployment disables them", async () => {
		const { env } = await import("@/config/env.ts")
		const descriptor = Object.getOwnPropertyDescriptor(env, "TALQO_MCP_ALLOW_STDIO")
		Object.defineProperty(env, "TALQO_MCP_ALLOW_STDIO", { configurable: true, value: false })
		const degraded: string[] = []
		try {
			const result = await openTools([stdioRow()], {
				...options,
				onDegraded: (_row, error) => degraded.push((error as Error).message),
			})

			expect(result.tools).toEqual({})
			expect(degraded).toEqual(["Stdio MCP servers are disabled on this deployment"])
			expect(connections).toHaveLength(0)
		} finally {
			if (descriptor) Object.defineProperty(env, "TALQO_MCP_ALLOW_STDIO", descriptor)
		}
	})
})

describe("discoverTools", () => {
	it("lists every page and closes the connection", async () => {
		const url = "https://shopify.test/mcp"
		const behavior = behaviorFor(url, {
			pages: [
				{ tools: [{ name: "first", inputSchema: {} }], nextCursor: "1" },
				{ tools: [{ name: "second", description: "Second tool", inputSchema: {} }] },
			],
		})

		const tools = await discoverTools(serverRow({ name: "Shopify", url }), { vault })

		expect(tools).toEqual([
			{ name: "first", description: "", enabled: true },
			{ name: "second", description: "Second tool", enabled: true },
		])
		expect(behavior.listCalls).toEqual([{ cursor: undefined }, { cursor: "1" }])
		expect(behavior.closeCalls).toBe(1)
	})

	it("reports an unreachable server as having no tools", async () => {
		const url = "https://broken.test/mcp"
		behaviorFor(url, { connectError: new Error("connection refused") })

		await expect(discoverTools(serverRow({ name: "Broken", url }), { vault })).resolves.toEqual([])
	})

	it("reports a failed listing as having no tools", async () => {
		const url = "https://broken.test/mcp"
		behaviorFor(url, { listError: new Error("listing failed") })

		await expect(discoverTools(serverRow({ name: "Broken", url }), { vault })).resolves.toEqual([])
	})
})
