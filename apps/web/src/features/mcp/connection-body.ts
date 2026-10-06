import type { CreateMcpServerBody } from "@/api/generated/models/mcp/createMcpServerBody.zod"
import type { UpdateMcpServerBody } from "@/api/generated/models/mcp/updateMcpServerBody.zod"
import type { McpServer } from "@/api/generated/models/mcpServer.zod"

import { toEnvRecord, type EnvVariable } from "@/features/mcp/mcp-env-variables"

/**
 * Rebuilds an update body from a server whose secrets came back masked. Entered values are sent,
 * removed names travel in deleteHeaders/deleteEnv, and whatever is mentioned in neither keeps its
 * stored envelope.
 */
export function toUpdateBody(
	server: McpServer,
	overrides: { isDisabled?: boolean; tools?: McpServer["tools"] } = {},
): UpdateMcpServerBody {
	const tools = overrides.tools ?? server.tools
	return {
		name: server.name,
		expectedRevision: server.revision,
		isDisabled: overrides.isDisabled ?? server.isDisabled,
		tools: tools.map(({ name, selected }) => ({ name, selected })),
		server:
			server.transport === "http"
				? { transport: "http", url: server.url ?? "", authMode: server.authMode ?? "none" }
				: { transport: "stdio", command: server.command ?? "", args: server.args },
	}
}

/** Flips one tool and leaves every other selection alone. */
export function toggleTool(tools: McpServer["tools"], name: string, selected: boolean): McpServer["tools"] {
	return tools.map((tool) => (tool.name === name ? { ...tool, selected } : tool))
}

/** The one thing an operator needs to recognise their own connection. */
export function connectionSummary(server: McpServer): string {
	return server.transport === "http" ? (server.url ?? "") : [server.command, ...server.args].join(" ")
}

export type ConnectionDraft = {
	name: string
	transport: "http" | "stdio"
	url: string
	authMode: "none" | "headers"
	command: string
	args: string[]
	headerName: string
	headerValue: string
	env: EnvVariable[]
}

export const EMPTY_DRAFT: ConnectionDraft = {
	name: "",
	transport: "http",
	url: "",
	authMode: "none",
	command: "",
	args: [],
	headerName: "",
	headerValue: "",
	env: [],
}

export type DraftReason = "nameRequired" | "addressRequired" | "commandRequired" | "secretRequired"

/**
 * Both halves are required before a secret is sent. Sending a name with an empty value would replace
 * the stored one with an empty string, and a blank field has to mean "leave it alone".
 */
function headerSecret(draft: ConnectionDraft) {
	return draft.headerName.trim() && draft.headerValue ? { [draft.headerName.trim()]: draft.headerValue } : undefined
}

const envCount = (env: Record<string, string>) => Object.keys(env).length

type StoredSecrets = { env: { name: string }[]; headers: { name: string }[] }
const storedNames = (entries: { name: string }[]) => entries.map(({ name }) => name)

function serverOf(draft: ConnectionDraft, stored?: StoredSecrets) {
	if (draft.transport === "http") {
		const base = { transport: "http" as const, url: draft.url.trim(), authMode: draft.authMode }
		if (draft.authMode !== "headers") return base
		const pair = headerSecret(draft)
		if (pair) {
			const [entered] = Object.keys(pair)
			const renamed = storedNames(stored?.headers ?? []).filter((name) => name !== entered)
			return { ...base, headers: pair, ...(renamed.length > 0 ? { deleteHeaders: renamed } : {}) }
		}
		// A cleared name on a connection that had one deletes it; otherwise there is nothing to say.
		const storedHeaders = storedNames(stored?.headers ?? [])
		if (!draft.headerName.trim() && !draft.headerValue && storedHeaders.length > 0)
			return { ...base, deleteHeaders: storedHeaders }
		return base
	}
	const env = toEnvRecord(draft.env)
	const present = new Set(draft.env.map(({ name }) => name.trim()).filter(Boolean))
	const removed = storedNames(stored?.env ?? []).filter((name) => !present.has(name))
	return {
		transport: "stdio" as const,
		command: draft.command.trim(),
		args: draft.args,
		...(envCount(env) > 0 ? { env } : {}),
		...(removed.length > 0 ? { deleteEnv: removed } : {}),
	}
}

export type CreateResult = { ok: true; body: CreateMcpServerBody } | { ok: false; reason: DraftReason }
export type UpdateResult = { ok: true; body: UpdateMcpServerBody } | { ok: false; reason: DraftReason }

function validate(draft: ConnectionDraft, requireSecretValue: boolean): DraftReason | undefined {
	if (!draft.name.trim()) return "nameRequired"
	if (draft.transport === "http") {
		if (!draft.url.trim()) return "addressRequired"
		// A value without a name goes nowhere on either path; on edit a blank pair deletes instead.
		if (draft.authMode === "headers" && !draft.headerName.trim() && (draft.headerValue || requireSecretValue))
			return "secretRequired"
		if (draft.authMode === "headers" && draft.headerName.trim() && !draft.headerValue && requireSecretValue)
			return "secretRequired"
	} else if (!draft.command.trim()) return "commandRequired"
	// A variable missing its name has nowhere to go.
	if (draft.env.some(({ name }) => !name.trim())) return "secretRequired"
	return undefined
}

export function toCreateBody(draft: ConnectionDraft): CreateResult {
	const reason = validate(draft, true)
	return reason ? { ok: false, reason } : { ok: true, body: { name: draft.name.trim(), server: serverOf(draft) } }
}

/** Editing keeps every stored tool selection; only the endpoint and secrets on the form can change. */
export function toEditBody(
	draft: ConnectionDraft,
	server: Pick<McpServer, "isDisabled" | "revision"> & StoredSecrets,
): UpdateResult {
	const reason = validate(draft, false)
	return reason
		? { ok: false, reason }
		: {
				ok: true,
				body: {
					name: draft.name.trim(),
					expectedRevision: server.revision,
					isDisabled: server.isDisabled,
					server: serverOf(draft, server),
				},
			}
}
