import type { createCredentialVault, CredentialSecretMap } from "@/lib/credential-vault.ts"
import type { ListToolsResult, MCPClient, MCPClientConfig } from "@ai-sdk/mcp"
import type { ToolSet } from "ai"

import { env } from "@/config/env.ts"
import { createMCPClient } from "@ai-sdk/mcp"
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio"
import { createHash } from "node:crypto"

import type { McpServerRow } from "./mcp.schema.ts"
import type { McpToolSnapshot } from "./mcp.types.ts"

import {
	MAX_STDIO_CONNECT_MS,
	MAX_TOOL_DESCRIPTION_CHARACTERS,
	MAX_TOOL_RESULT_CHARACTERS,
	STDIO_INHERITED_ENV,
	TOOL_LIST_TIMEOUT_MS,
} from "./mcp.types.ts"

type Vault = ReturnType<typeof createCredentialVault>

export const TOOL_NAME_MAX_LENGTH = 64
const HASH_HEX_LENGTH = 6

/** Provider tool-name grammars reject `shopify.get_product`, so names are sanitized and namespaced. */
export function namespaceToolName(serverName: string, toolName: string): string {
	const joined = `${serverName.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}__${toolName.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}`
	if (joined.length <= TOOL_NAME_MAX_LENGTH) return joined
	const hash = createHash("sha256").update(joined).digest("hex").slice(0, HASH_HEX_LENGTH)
	return `${joined.slice(0, TOOL_NAME_MAX_LENGTH - hash.length - 1)}_${hash}`
}

function inheritedEnv(): Record<string, string> {
	return Object.fromEntries(
		STDIO_INHERITED_ENV.flatMap((name) => {
			const value = process.env[name]
			return value === undefined ? [] : [[name, value]]
		}),
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
		// Write-time validation blocks new rows; this stops servers configured before the flag flipped.
		if (!env.TALQO_MCP_ALLOW_STDIO) throw new Error("Stdio MCP servers are disabled on this deployment")
		if (row.command === null) throw new Error(`MCP server ${row.name} has no command`)
		return new Experimental_StdioMCPTransport({
			command: row.command,
			args: row.args,
			// Only Talqo's harmless variables plus the operator's own; no APP_SECRET, no DATABASE_URL.
			env: { ...inheritedEnv(), ...secretsOf(row.env, vault, row, "env") },
		})
	}
	if (row.url === null) throw new Error(`MCP server ${row.name} has no URL`)
	const headers = secretsOf(row.headers, vault, row, "header")
	return {
		type: "http",
		url: row.url,
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
	do {
		// Each cursor is only known once the previous page arrives, so these cannot be parallel.
		const listed: ListToolsResult = await withListTimeout(
			client.listTools(cursor ? { params: { cursor } } : undefined),
			signal,
		)
		collected.push(...listed.tools)
		cursor = listed.nextCursor
	} while (cursor)
	return collected
}

export async function withListTimeout<T>(listing: Promise<T>, signal?: AbortSignal): Promise<T> {
	signal?.throwIfAborted()
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("MCP tool listing timed out")), TOOL_LIST_TIMEOUT_MS)
		let settled = false
		const onAbort = () => {
			queueMicrotask(() => {
				if (!settled) reject(signal?.reason ?? new Error("MCP tool listing aborted"))
			})
		}
		signal?.addEventListener("abort", onAbort, { once: true })
		listing.then(
			(value) => {
				settled = true
				clearTimeout(timer)
				signal?.removeEventListener("abort", onAbort)
				resolve(value)
			},
			(error: unknown) => {
				settled = true
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
export async function discoverTools(row: McpServerRow, options: McpConnectOptions): Promise<Array<McpToolSnapshot>> {
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
	rows: Array<McpServerRow>,
	options: McpConnectOptions & { onDegraded: (row: McpServerRow, error: unknown) => void },
): Promise<OpenToolsResult> {
	const tools: ToolSet = {}
	const names = new Map<string, { serverName: string; toolName: string }>()
	const clients: Array<MCPClient> = []
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

const TRUNCATED_RESULT_MARKER = "…[truncated, the server returned more]"

function isTextPart(part: unknown): part is { type: "text"; text: string } {
	return (
		part !== null &&
		typeof part === "object" &&
		"type" in part &&
		part.type === "text" &&
		"text" in part &&
		typeof part.text === "string"
	)
}

// A hostile server could burn model context. All parts share one budget and at most one marker.
class ToolResultBudget {
	remaining = MAX_TOOL_RESULT_CHARACTERS
	marked = false
	content: Array<unknown> = []

	appendText(part: { type: "text"; text: string }): void {
		const { text } = part
		if (text.length <= this.remaining) {
			this.remaining -= text.length
			this.content.push(part)
			return
		}
		const marker = this.marked ? "" : TRUNCATED_RESULT_MARKER
		this.marked = true
		this.content.push(Object.assign({}, part, { text: `${text.slice(0, this.remaining)}${marker}` }))
		this.remaining = 0
	}

	appendStructured(part: unknown): void {
		const size = JSON.stringify(part)?.length ?? 0
		if (size > this.remaining) {
			if (!this.marked) {
				this.marked = true
				this.content.push({ type: "text", text: TRUNCATED_RESULT_MARKER })
			}
			return
		}
		this.remaining -= size
		this.content.push(part)
	}
}

function hasResultContent(result: unknown): result is { content: Array<unknown> } {
	return result !== null && typeof result === "object" && "content" in result && Array.isArray(result.content)
}

export function truncateResult(result: unknown): unknown {
	if (typeof result === "string")
		return result.length <= MAX_TOOL_RESULT_CHARACTERS
			? result
			: `${result.slice(0, MAX_TOOL_RESULT_CHARACTERS)}${TRUNCATED_RESULT_MARKER}`
	if (!hasResultContent(result)) return result
	const budget = new ToolResultBudget()
	for (const part of result.content) {
		if (isTextPart(part)) budget.appendText(part)
		else budget.appendStructured(part)
	}
	return Object.assign({}, result, { content: budget.content })
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
