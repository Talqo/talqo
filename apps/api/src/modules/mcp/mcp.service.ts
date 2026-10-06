import type { CredentialSecretMap } from "@/lib/credential-vault.ts"
import type * as aiProvider from "@/modules/ai-provider/ai-provider.service.ts"
import type { ToolBinding } from "@/modules/ai-provider/ai-provider.service.ts"

import { env } from "@/config/env.ts"
import { createCredentialVault } from "@/lib/credential-vault.ts"
import { isForeignKeyViolation, isUniqueViolation } from "@/lib/pg-error.ts"
import { auth } from "@ai-sdk/mcp"

import type { McpServerPatch } from "./mcp.schema.ts"
import type { McpServerRow } from "./mcp.schema.ts"
import type {
	McpCreateInput,
	McpHttpInput,
	McpSecretName,
	McpServerView,
	McpStdioInput,
	McpToolSnapshot,
	McpUpdateInput,
} from "./mcp.types.ts"

import { discoverTools, openTools as openServerTools } from "./mcp.client.ts"
import { AuthorizationServerChangedError, createOAuthProvider } from "./mcp.oauth.ts"
import * as repo from "./mcp.repository.ts"
import { MCP_SERVER_NAME_MAX_LENGTH } from "./mcp.types.ts"

const KEY_CONTEXT = "talqo:mcp-credentials:v1"
const RESERVED_HEADER_PREFIX = "mcp-"
const URL_SCHEMES = new Set(["http:", "https:"])
const OAUTH_COLUMNS = { oauthTokens: null, oauthClient: null, oauthPending: null, oauthStateExpiresAt: null } as const

export class McpServerNotFoundError extends Error {}
export class DuplicateMcpServerNameError extends Error {}
export class UnknownAgentError extends Error {}
export class RevisionConflictError extends Error {}
export class InvalidMcpServerError extends Error {}
export { AuthorizationServerChangedError }

export type OpenTools = {
	close: () => Promise<void>
	names: Map<string, aiProvider.ToolIdentity>
	tools: ToolBinding["tools"]
}

const vault = () => createCredentialVault(env.APP_SECRET, KEY_CONTEXT)

async function ownedRow(agentId: string, serverId: string): Promise<McpServerRow> {
	const row = await repo.find(serverId)
	if (!row || row.agentId !== agentId) throw new McpServerNotFoundError(`Server ${serverId} not found`)
	return row
}

function secretNames(map: Record<string, unknown> | null): McpSecretName[] {
	return Object.keys(map ?? {}).map((name) => ({ name, hasValue: true }))
}

function toView(row: McpServerRow): McpServerView {
	return {
		id: row.id,
		name: row.name,
		transport: row.transport,
		url: row.url,
		authMode: row.authMode,
		command: row.command,
		args: row.args,
		headers: secretNames(row.headers),
		env: secretNames(row.env),
		tools: row.tools,
		toolCount: row.tools.length,
		isWorking: row.tools.length > 0,
		isDisabled: row.isDisabled,
		revision: row.revision,
	}
}

function assertValid(input: McpCreateInput): void {
	if (!input.name.trim() || input.name.length > MCP_SERVER_NAME_MAX_LENGTH)
		throw new InvalidMcpServerError(`Name must be 1-${MCP_SERVER_NAME_MAX_LENGTH} characters`)
	if (input.transport !== "http") return
	let url: URL
	try {
		url = new URL(input.url)
	} catch {
		throw new InvalidMcpServerError("Address must be a valid http or https URL")
	}
	if (!URL_SCHEMES.has(url.protocol)) throw new InvalidMcpServerError("Address must use http or https")
	for (const name of Object.keys(input.headers ?? {})) {
		const lower = name.toLowerCase()
		if (lower === "authorization" && input.authMode === "oauth")
			throw new InvalidMcpServerError("Authorization is managed by the sign-in flow")
		if (lower.startsWith(RESERVED_HEADER_PREFIX)) throw new InvalidMcpServerError(`${name} is reserved by MCP`)
	}
}

/**
 * Secrets come back masked, so an update can only carry a subset of names. Whatever the operator
 * leaves out keeps its stored envelope instead of being erased.
 */
function mergeSecrets(
	existing: CredentialSecretMap | null | undefined,
	serverId: string,
	input: Record<string, string> | undefined,
	purpose: "env" | "header",
): CredentialSecretMap {
	const seal = createCredentialVault(env.APP_SECRET, KEY_CONTEXT)
	const merged: CredentialSecretMap = { ...existing }
	for (const [name, value] of Object.entries(input ?? {})) merged[name] = seal.encrypt(value, { serverId, purpose })
	return merged
}

function httpColumns(serverId: string, input: McpHttpInput, existing?: CredentialSecretMap | null): McpServerPatch {
	return {
		url: input.url,
		authMode: input.authMode,
		headers: input.authMode === "headers" ? mergeSecrets(existing, serverId, input.headers, "header") : null,
		command: null,
		args: [],
		env: {},
	}
}

function stdioColumns(serverId: string, input: McpStdioInput, existing?: CredentialSecretMap | null): McpServerPatch {
	return {
		url: null,
		authMode: null,
		headers: null,
		command: input.command,
		args: input.args ?? [],
		env: mergeSecrets(existing, serverId, input.env, "env"),
		...OAUTH_COLUMNS,
	}
}

/** Preserves the operator's selection by tool name; tools the server has dropped simply disappear. */
function mergeTools(previous: McpToolSnapshot[], discovered: McpToolSnapshot[]): McpToolSnapshot[] {
	const selected = new Set(previous.filter((tool) => tool.selected).map((tool) => tool.name))
	return discovered.map((tool) => ({ ...tool, selected: selected.has(tool.name) }))
}

function endpointChanged(existing: McpServerRow, input: McpCreateInput): boolean {
	if (existing.transport !== input.transport) return true
	if (input.transport === "http") return existing.url !== input.url || existing.authMode !== input.authMode
	return existing.command !== input.command
}

/** A connection works when it offered tools. A failure leaves the configuration and any snapshot alone. */
async function withDiscoveredTools(row: McpServerRow): Promise<McpServerRow> {
	const discovered = await discoverTools(row, { vault: vault() })
	if (discovered.length === 0) return row
	return (await repo.update(row.id, { tools: mergeTools(row.tools, discovered) })) ?? row
}

export async function listServers(agentId: string): Promise<McpServerView[]> {
	return (await repo.listForAgent(agentId)).map(toView)
}

export async function getServer(agentId: string, serverId: string): Promise<McpServerView> {
	return toView(await ownedRow(agentId, serverId))
}

export async function createServer(agentId: string, input: McpCreateInput): Promise<McpServerView> {
	assertValid(input)
	const id = crypto.randomUUID()
	try {
		const row = await repo.insert({
			id,
			agentId,
			name: input.name.trim(),
			transport: input.transport,
			...(input.transport === "http" ? httpColumns(id, input) : stdioColumns(id, input)),
		})
		return toView(await withDiscoveredTools(row))
	} catch (error) {
		if (isUniqueViolation(error)) throw new DuplicateMcpServerNameError(`Already named ${input.name}`)
		if (isForeignKeyViolation(error)) throw new UnknownAgentError(`Agent ${agentId} not found`)
		throw error
	}
}

export async function updateServer(agentId: string, serverId: string, input: McpUpdateInput): Promise<McpServerView> {
	const existing = await ownedRow(agentId, serverId)
	assertValid(input)
	const base =
		input.transport === "http"
			? { ...httpColumns(serverId, input, existing.headers), ...(input.authMode === "oauth" ? {} : OAUTH_COLUMNS) }
			: stdioColumns(serverId, input, existing.env)
	// A changed endpoint invalidates the snapshot; otherwise the operator's selection is applied to it.
	const tools = endpointChanged(existing, input)
		? []
		: (input.tools ?? []).length > 0
			? existing.tools.map((tool) => ({
					...tool,
					selected: input.tools?.find((entry) => entry.name === tool.name)?.selected ?? tool.selected,
				}))
			: existing.tools
	const saved = await repo.updateAtRevision(
		serverId,
		{ ...base, name: input.name.trim(), isDisabled: input.isDisabled ?? existing.isDisabled, tools },
		input.expectedRevision,
	)
	if (!saved) throw new RevisionConflictError("Connection changed; reload and retry")
	return toView(await withDiscoveredTools(saved))
}

export async function deleteServer(agentId: string, serverId: string): Promise<void> {
	await ownedRow(agentId, serverId)
	await repo.remove(serverId)
}

/** Flipping the flag never disturbs the configuration or its secrets. */
export async function setServerDisabled(
	agentId: string,
	serverId: string,
	isDisabled: boolean,
): Promise<McpServerView> {
	const row = await ownedRow(agentId, serverId)
	return toView((await repo.update(serverId, { isDisabled })) ?? row)
}

/** Called from `conversation.run`, where an abort signal exists. Chat never fails because of MCP. */
export async function openTools(agentId: string, signal: AbortSignal): Promise<OpenTools> {
	const enabled = (await repo.listForAgent(agentId)).filter((row) => !row.isDisabled)
	return openServerTools(enabled, {
		vault: vault(),
		signal,
		onDegraded(row, error) {
			console.error("mcp.server.degraded", { agentId, serverId: row.id, transport: row.transport, error })
		},
	})
}

/** Returns the URL the operator's browser must follow, or null when the server needs no sign-in. */
export async function beginAuthorization(agentId: string, serverId: string, origin: string): Promise<string | null> {
	const row = await ownedRow(agentId, serverId)
	if (row.transport !== "http" || row.authMode !== "oauth")
		throw new InvalidMcpServerError("This connection does not use sign-in")
	let destination: URL | undefined
	const provider = createOAuthProvider({
		row,
		vault: vault(),
		redirectUrl: `${origin}/api/agents/${agentId}/mcp-servers/${serverId}/oauth/callback`,
		onAuthorizationUrl: async (url) => {
			destination = url
		},
		write: (patch) => repo.update(serverId, patch).then(() => undefined),
	})
	const result = await auth(provider, { serverUrl: row.url! })
	if (result === "REDIRECT") return destination?.toString() ?? null
	return null
}

export async function completeAuthorization(
	agentId: string,
	serverId: string,
	origin: string,
	query: { code: string; state: string },
): Promise<void> {
	const row = await ownedRow(agentId, serverId)
	const provider = createOAuthProvider({
		row,
		vault: vault(),
		redirectUrl: `${origin}/api/agents/${agentId}/mcp-servers/${serverId}/oauth/callback`,
		onAuthorizationUrl: async () => {
			throw new InvalidMcpServerError("Authorization did not complete in one step")
		},
		write: (patch) => repo.update(serverId, patch).then(() => undefined),
	})
	await auth(provider, { serverUrl: row.url!, authorizationCode: query.code, callbackState: query.state })
}
