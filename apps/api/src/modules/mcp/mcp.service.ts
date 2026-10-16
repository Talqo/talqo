import type { CredentialSecretMap } from "@/lib/credential-vault.ts"

import { env } from "@/config/env.ts"
import { ApiError, PROBLEM_CODES } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { createCredentialVault } from "@/lib/credential-vault.ts"
import { isForeignKeyViolation, isUniqueViolation } from "@/lib/pg-error.ts"

import type { OpenToolsResult } from "./mcp.client.ts"
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
import * as repo from "./mcp.repository.ts"
import { MCP_SERVER_NAME_MAX_LENGTH } from "./mcp.types.ts"

const KEY_CONTEXT = "talqo:mcp-credentials:v1"
const RESERVED_HEADER_PREFIX = "mcp-"
const URL_SCHEMES = new Set(["http:", "https:"])

class McpServerNotFoundError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.MCP_SERVER_NOT_FOUND, HTTP_STATUS.NOT_FOUND, message, undefined, options)
	}
}
export class DuplicateMcpServerNameError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.DUPLICATE_MCP_SERVER_NAME, HTTP_STATUS.CONFLICT, message, undefined, options)
	}
}
class UnknownAgentError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.AGENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND, message, undefined, options)
	}
}
export class RevisionConflictError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.CONFIGURATION_CONFLICT, HTTP_STATUS.CONFLICT, message, undefined, options)
	}
}
export class InvalidMcpServerError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.INVALID_MCP_SERVER_URL, HTTP_STATUS.BAD_REQUEST, message, undefined, options)
	}
}
export class InvalidMcpServerNameError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.INVALID_MCP_SERVER_NAME, HTTP_STATUS.BAD_REQUEST, message, undefined, options)
	}
}

/** The open connection that conversation holds for one generation. */
export type OpenTools = OpenToolsResult

const vault = createCredentialVault(env.APP_SECRET, KEY_CONTEXT)

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
		throw new InvalidMcpServerNameError(`Name must be 1-${MCP_SERVER_NAME_MAX_LENGTH} characters`)
	// The name becomes part of provider tool names, whose grammars accept printable ASCII only.
	if (!/^[\x20-\x7E]+$/.test(input.name)) throw new InvalidMcpServerNameError("Name must contain ASCII characters only")
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
		if (lower.startsWith(RESERVED_HEADER_PREFIX)) throw new InvalidMcpServerError(`${name} is reserved by MCP`)
	}
}

/**
 * Secrets come back masked, so an update carries only entered values plus the names to forget.
 * Whatever the operator leaves out keeps its stored envelope instead of being erased.
 */
function mergeSecrets(
	existing: CredentialSecretMap | null | undefined,
	serverId: string,
	input: Record<string, string> | undefined,
	remove: string[] | undefined,
	purpose: "env" | "header",
): CredentialSecretMap {
	const merged: CredentialSecretMap = { ...existing }
	for (const name of remove ?? []) delete merged[name]
	for (const [name, value] of Object.entries(input ?? {})) merged[name] = vault.encrypt(value, { serverId, purpose })
	return merged
}

function httpColumns(serverId: string, input: McpHttpInput, existing?: CredentialSecretMap | null): McpServerPatch {
	return {
		url: input.url,
		authMode: input.authMode,
		headers:
			input.authMode === "headers"
				? mergeSecrets(existing, serverId, input.headers, input.deleteHeaders, "header")
				: null,
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
		env: mergeSecrets(existing, serverId, input.env, input.deleteEnv, "env"),
	}
}

/** Existing tools keep their enabled flag. New tools start enabled. */
function mergeTools(previous: McpToolSnapshot[], discovered: McpToolSnapshot[]): McpToolSnapshot[] {
	const previousByName = new Map(previous.map((tool) => [tool.name, tool.enabled]))
	return discovered.map((tool) => ({ ...tool, enabled: previousByName.get(tool.name) ?? true }))
}

/** The toggle path always sends the complete list, so an explicit empty list disables everything. */
function applySelection(previous: McpToolSnapshot[], updates: { enabled: boolean; name: string }[]): McpToolSnapshot[] {
	const enabled = new Set(updates.filter((entry) => entry.enabled).map((entry) => entry.name))
	return previous.map((tool) => ({ ...tool, enabled: enabled.has(tool.name) }))
}

function endpointChanged(existing: McpServerRow, input: McpCreateInput): boolean {
	if (existing.transport !== input.transport) return true
	if (input.transport === "http") return existing.url !== input.url || existing.authMode !== input.authMode
	return existing.command !== input.command || JSON.stringify(existing.args) !== JSON.stringify(input.args ?? [])
}

/** A connection works when it offered tools. A failure leaves the configuration and any snapshot alone. */
async function withDiscoveredTools(row: McpServerRow): Promise<McpServerRow> {
	const discovered = await discoverTools(row, { vault })
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
			? httpColumns(serverId, input, existing.headers)
			: stdioColumns(serverId, input, existing.env)
	// A changed endpoint invalidates the snapshot; otherwise the operator's toggles are applied to it.
	const tools = endpointChanged(existing, input)
		? []
		: input.tools !== undefined
			? applySelection(existing.tools, input.tools)
			: existing.tools
	const saved = await repo.updateAtRevision(
		serverId,
		{ ...base, name: input.name.trim(), tools },
		input.expectedRevision,
	)
	if (!saved) throw new RevisionConflictError("Connection changed; reload and retry")
	return toView(await withDiscoveredTools(saved))
}

export async function deleteServer(agentId: string, serverId: string): Promise<void> {
	await ownedRow(agentId, serverId)
	await repo.remove(serverId)
}

/** Toggling disabled leaves configuration and secrets unchanged. */
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
		vault,
		signal,
		onDegraded(row, error) {
			console.error("mcp.server.degraded", { agentId, serverId: row.id, transport: row.transport, error })
		},
	})
}
