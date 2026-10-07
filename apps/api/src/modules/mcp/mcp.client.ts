import type { CredentialSecretMap, createCredentialVault } from "@/lib/credential-vault.ts"
import type { MCPClient, MCPClientConfig } from "@ai-sdk/mcp"
import type { ListToolsResult } from "@ai-sdk/mcp"
import type { ToolSet } from "ai"

import { createMCPClient } from "@ai-sdk/mcp"
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio"
import { createHash } from "node:crypto"

import type { McpServerRow } from "./mcp.schema.ts"
import type { McpToolSnapshot } from "./mcp.types.ts"

import {
	MAX_STDIO_CONNECT_MS,
	MAX_TOOL_DESCRIPTION_CHARACTERS,
	MAX_TOOL_LIST_PAGES,
	MAX_TOOL_RESULT_CHARACTERS,
	STDIO_INHERITED_ENV,
	TOOL_LIST_TIMEOUT_MS,
} from "./mcp.types.ts"

type Vault = ReturnType<typeof createCredentialVault>

const TOOL_NAME_MAX_LENGTH = 64
const HASH_HEX_LENGTH = 6

/** Provider tool-name grammars reject `shopify.get_product`, so names are sanitized and namespaced. */
export function namespaceToolName(serverName: string, toolName: string): string {
	const joined = `${serverName.replace(/[^a-zA-Z0-9_-]/g, "_")}__${toolName.replace(/[^a-zA-Z0-9_-]/g, "_")}`
	if (joined.length <= TOOL_NAME_MAX_LENGTH) return joined
	const hash = createHash("sha256").update(joined).digest("hex").slice(0, HASH_HEX_LENGTH)
	return `${joined.slice(0, TOOL_NAME_MAX_LENGTH - hash.length - 1)}_${hash}`
}

function inheritedEnv(): Record<string, string> {
	return Object.fromEntries(
		STDIO_INHERITED_ENV.filter((name) => process.env[name]).map((name) => [name, process.env[name]!]),
	)
}

/** `purpose` is part of the sealed context, so a header value cannot be read as an environment value. */
function secretsOf(
	map: CredentialSecretMap | null,
	vault: Vault,
	row: McpServerRow,
	purpose: "env" | "header",
): Record<string, string> {
	const context = { serverId: row.id, purpose }
	return Object.fromEntries(
		Object.entries(map ?? {}).map(([name, envelope]) => [name, vault.decrypt<string>(envelope, context)]),
	)
}

export type McpConnectOptions = {
	signal?: AbortSignal
	vault: Vault
}

function buildTransport(row: McpServerRow, options: McpConnectOptions): MCPClientConfig["transport"] {
	const { vault } = options
	if (row.transport === "stdio") {
		return new Experimental_StdioMCPTransport({
			command: row.command!,
			args: row.args,
			// Only Talqo's harmless variables plus the operator's own; no APP_SECRET, no DATABASE_URL.
			env: { ...inheritedEnv(), ...secretsOf(row.env, vault, row, "env") },
		})
	}
	const headers = secretsOf(row.headers, vault, row, "header")
	return {
		type: "http",
		url: row.url!,
		...(Object.keys(headers).length > 0 ? { headers } : {}),
		redirect: "error",
	}
}

async function connect(row: McpServerRow, options: McpConnectOptions): Promise<MCPClient> {
	return createMCPClient({
		transport: buildTransport(row, options),
		initializationOptions: { signal: options.signal, timeout: MAX_STDIO_CONNECT_MS },
		maxRetries: 0,
	})
}

async function listAllTools(client: MCPClient, signal?: AbortSignal): Promise<ListToolsResult["tools"]> {
	const collected: ListToolsResult["tools"] = []
	let cursor: string | undefined
	// A hostile server answers every page with another cursor; the page cap keeps one listing from
	// hanging the chat that triggered it. Timeouts surface as degraded, never as chat failures.
	for (let page = 0; page < MAX_TOOL_LIST_PAGES; page++) {
		// Each cursor is only known once the previous page arrives, so these cannot be parallel.
		// oxlint-disable-next-line no-await-in-loop -- sequential pagination.
		const listed: ListToolsResult = await withListTimeout(
			client.listTools(cursor ? { params: { cursor } } : undefined),
			signal,
		)
		collected.push(...listed.tools)
		cursor = listed.nextCursor
		if (!cursor) break
	}
	return collected
}

function withListTimeout<T>(listing: Promise<T>, signal?: AbortSignal): Promise<T> {
	signal?.throwIfAborted()
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("MCP tool listing timed out")), TOOL_LIST_TIMEOUT_MS)
		const onAbort = () => reject(signal?.reason ?? new Error("MCP tool listing aborted"))
		signal?.addEventListener("abort", onAbort, { once: true })
		listing.then(
			(value) => {
				clearTimeout(timer)
				signal?.removeEventListener("abort", onAbort)
				resolve(value)
			},
			(error: unknown) => {
				clearTimeout(timer)
				signal?.removeEventListener("abort", onAbort)
				reject(error instanceof Error ? error : new Error("MCP tool listing failed"))
			},
		)
	})
}

/**
 * Connects, lists tools, closes. Returns an empty list when unreachable. No tools counts as not working.
 */
export async function discoverTools(row: McpServerRow, options: McpConnectOptions): Promise<McpToolSnapshot[]> {
	let client: MCPClient | undefined
	try {
		client = await connect(row, options)
		return (await listAllTools(client, options.signal)).map((tool) => ({
			description: tool.description ?? "",
			enabled: true,
			name: tool.name,
		}))
	} catch {
		return []
	} finally {
		await client?.close().catch(() => {})
	}
}

export type OpenToolsResult = {
	close: () => Promise<void>
	/** Namespaced tool name to the server and tool names shown to operators. */
	names: Map<string, { serverName: string; toolName: string }>
	tools: ToolSet
}

/**
 * Resolves callable tools for one generation. Server-level failures drop that server only, so a single
 * broken integration cannot cost the agent every tool it has.
 */
export async function openTools(
	rows: McpServerRow[],
	options: McpConnectOptions & { onDegraded: (row: McpServerRow, error: unknown) => void },
): Promise<OpenToolsResult> {
	const tools: ToolSet = {}
	const names = new Map<string, { serverName: string; toolName: string }>()
	const clients: MCPClient[] = []
	await Promise.all(
		rows.map(async (row) => {
			const enabled = new Set(row.tools.filter((tool) => tool.enabled).map((tool) => tool.name))
			if (enabled.size === 0) return
			try {
				const client = await connect(row, options)
				clients.push(client)
				const live = (await listAllTools(client, options.signal)).filter((tool) => enabled.has(tool.name))
				const built = client.toolsFromDefinitions({ tools: live })
				for (const [toolName, tool] of Object.entries(built)) {
					const key = namespaceToolName(row.name, toolName)
					// `my server` and `my_server` sanitize identically; the first server keeps the name.
					if (key in tools) {
						options.onDegraded(row, new Error(`Tool name ${key} is already taken by another connection`))
						continue
					}
					tools[key] = boundTool(tool)
					names.set(key, { serverName: row.name, toolName })
				}
			} catch (error) {
				options.onDegraded(row, error)
			}
		}),
	)
	let closed = false
	return {
		names,
		tools,
		async close() {
			if (closed) return
			closed = true
			await Promise.all(clients.map((client) => client.close().catch(() => {})))
		},
	}
}

/** `description` may be a lazy factory, so only a plain string is bounded. */
function truncateDescription(tool: ToolSet[string]): ToolSet[string] {
	const { description } = tool
	if (typeof description !== "string" || description.length <= MAX_TOOL_DESCRIPTION_CHARACTERS) return tool
	return { ...tool, description: description.slice(0, MAX_TOOL_DESCRIPTION_CHARACTERS) }
}

/**
 * A hostile server could burn model context, so text parts are cut at a shared budget with a marker.
 */
function truncateResult(result: unknown): unknown {
	if (typeof result === "string")
		return result.length <= MAX_TOOL_RESULT_CHARACTERS
			? result
			: `${result.slice(0, MAX_TOOL_RESULT_CHARACTERS)}…[truncated, the server returned more]`
	if (!result || typeof result !== "object" || !Array.isArray((result as { content?: unknown }).content)) return result
	let remaining = MAX_TOOL_RESULT_CHARACTERS
	const content: unknown[] = []
	for (const part of (result as { content: unknown[] }).content) {
		if (
			!part ||
			typeof part !== "object" ||
			(part as { type?: unknown }).type !== "text" ||
			typeof (part as { text?: unknown }).text !== "string"
		) {
			content.push(part)
			continue
		}
		const text = (part as { text: string }).text
		if (text.length <= remaining) {
			remaining -= text.length
			content.push(part)
			continue
		}
		content.push(Object.assign({}, part, { text: `${text.slice(0, remaining)}…[truncated, the server returned more]` }))
		remaining = 0
	}
	return Object.assign({}, result, { content })
}

function boundTool(tool: ToolSet[string]): ToolSet[string] {
	const described = truncateDescription(tool)
	const { execute } = described
	if (!execute) return described
	return {
		...described,
		execute: (async (...call: Parameters<typeof execute>) => truncateResult(await execute(...call))) as typeof execute,
	}
}
