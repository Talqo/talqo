import type { CredentialSecretMap, createCredentialVault } from "@/lib/credential-vault.ts"
import type { MCPClient, MCPClientConfig, OAuthClientProvider } from "@ai-sdk/mcp"
import type { ListToolsResult } from "@ai-sdk/mcp"
import type { ToolSet } from "ai"

import { createMCPClient } from "@ai-sdk/mcp"
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio"
import { createHash } from "node:crypto"

import type { McpServerRow } from "./mcp.schema.ts"
import type { McpToolSnapshot } from "./mcp.types.ts"

import { MAX_STDIO_CONNECT_MS, MAX_TOOL_DESCRIPTION_CHARACTERS, STDIO_INHERITED_ENV } from "./mcp.types.ts"

type Vault = ReturnType<typeof createCredentialVault>

const TOOL_NAME_MAX_LENGTH = 64
const HASH_HEX_LENGTH = 6
const PROBE_DETAIL_MAX_LENGTH = 200

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
	authProvider?: OAuthClientProvider
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
		...(options.authProvider ? { authProvider: options.authProvider } : {}),
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

async function listAllTools(client: MCPClient): Promise<ListToolsResult["tools"]> {
	const collected: ListToolsResult["tools"] = []
	let cursor: string | undefined
	do {
		// Each cursor is only known once the previous page arrives, so these cannot be parallel.
		// oxlint-disable-next-line no-await-in-loop -- sequential pagination.
		const page: ListToolsResult = await client.listTools(cursor ? { params: { cursor } } : undefined)
		collected.push(...page.tools)
		cursor = page.nextCursor
	} while (cursor)
	return collected
}

export type McpProbeResult = { detail?: string; tools: McpToolSnapshot[] }

function probeFailure(error: unknown): McpProbeResult {
	const message = error instanceof Error ? error.message : String(error)
	return { tools: [], detail: message.slice(0, PROBE_DETAIL_MAX_LENGTH) }
}

/** Connects, lists tools, closes. Never throws: a broken server must not cost the operator their setup. */
export async function probe(row: McpServerRow, options: McpConnectOptions): Promise<McpProbeResult> {
	let client: MCPClient | undefined
	try {
		client = await connect(row, options)
		const tools = (await listAllTools(client)).map((tool) => ({
			name: tool.name,
			description: tool.description ?? "",
			selected: true,
		}))
		return { tools }
	} catch (error) {
		return probeFailure(error)
	} finally {
		await client?.close().catch(() => {})
	}
}

export type OpenToolsResult = {
	close: () => Promise<void>
	/** Namespaced tool name -> the server's own names, so events never show the mangled form. */
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
			// An empty selection is skipped before connecting, so it costs neither a process nor a round trip.
			const selected = new Set(row.tools.filter((tool) => tool.selected).map((tool) => tool.name))
			if (selected.size === 0) return
			try {
				const client = await connect(row, options)
				clients.push(client)
				const live = (await listAllTools(client)).filter((tool) => selected.has(tool.name))
				const built = client.toolsFromDefinitions({ tools: live })
				for (const [toolName, tool] of Object.entries(built)) {
					const key = namespaceToolName(row.name, toolName)
					tools[key] = truncateDescription(tool)
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
