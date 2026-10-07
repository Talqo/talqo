import type { CreateMcpServerBody } from "@/api/generated/models/mcp/createMcpServerBody.zod"
import type { UpdateMcpServerBody } from "@/api/generated/models/mcp/updateMcpServerBody.zod"
import type { McpServer } from "@/api/generated/models/mcpServer.zod"
import type { ArgumentRow } from "@/features/mcp/mcp-arguments"

import { toEnvRecord, type EnvVariable } from "@/features/mcp/mcp-env-variables"

/**
 * Rebuilds an update body from pieces the dialog or the card assembled. Secrets travel as entered
 * values plus the names to forget; whatever is mentioned in neither keeps its stored envelope.
 */
type UpdateAssembly = Pick<McpServer, "isDisabled" | "name" | "revision"> & {
	server: UpdateMcpServerBody["server"]
}

function toUpdateBody(base: UpdateAssembly, tools?: { name: string; selected: boolean }[]): UpdateMcpServerBody {
	return {
		name: base.name,
		expectedRevision: base.revision,
		isDisabled: base.isDisabled,
		...(tools ? { tools } : {}),
		server: base.server,
	}
}

/** The endpoint and secrets as the operator left them; the stored tool selection is untouched. */
function storedServer(server: McpServer): UpdateMcpServerBody["server"] {
	return server.transport === "http"
		? { transport: "http", url: server.url ?? "", authMode: server.authMode ?? "none" }
		: { transport: "stdio", command: server.command ?? "", args: server.args }
}

/** The toggle path always sends the complete list, so an explicit empty list deselects everything. */
export function toggledBody(server: McpServer, name: string, selected: boolean): UpdateMcpServerBody {
	return toUpdateBody(
		{ name: server.name, revision: server.revision, isDisabled: server.isDisabled, server: storedServer(server) },
		toggleTool(server.tools, name, selected).map((tool) => ({ name: tool.name, selected: tool.selected })),
	)
}

export function toggleTool(tools: McpServer["tools"], name: string, selected: boolean): McpServer["tools"] {
	return tools.map((tool) => (tool.name === name ? { ...tool, selected } : tool))
}

export function connectionSummary(server: McpServer): string {
	return server.transport === "http" ? (server.url ?? "") : [server.command, ...server.args].join(" ")
}

export type ConnectionDraft = {
	name: string
	transport: "http" | "stdio"
	url: string
	authMode: "none" | "headers"
	command: string
	args: ArgumentRow[]
	headers: EnvVariable[]
	env: EnvVariable[]
}

export const EMPTY_DRAFT: ConnectionDraft = {
	name: "",
	transport: "http",
	url: "",
	authMode: "none",
	command: "",
	args: [],
	headers: [],
	env: [],
}

export type DraftReason = "nameRequired" | "addressRequired" | "commandRequired" | "secretRequired"

type StoredSecrets = { env: { name: string }[]; headers: { name: string }[] }

/**
 * Rows are typed in place, so only entered values are sent and a stored name missing from the
 * rows is forgotten. Blanks are filtered and repeats collapse here rather than at save time.
 */
function secretsDiff(rows: EnvVariable[], stored: { name: string }[]) {
	const record = toEnvRecord(rows)
	const present = new Set(rows.map(({ name }) => name.trim()).filter(Boolean))
	const removed = stored.map(({ name }) => name).filter((name) => !present.has(name))
	return { record, removed }
}

function secretFields(
	rows: EnvVariable[],
	stored: { name: string }[],
	recordKey: "env" | "headers",
	deleteKey: "deleteEnv" | "deleteHeaders",
) {
	const { record, removed } = secretsDiff(rows, stored)
	return {
		...(Object.keys(record).length > 0 ? { [recordKey]: record } : {}),
		...(removed.length > 0 ? { [deleteKey]: removed } : {}),
	}
}

function serverOf(draft: ConnectionDraft, stored?: StoredSecrets) {
	if (draft.transport === "http") {
		const base = { transport: "http" as const, url: draft.url.trim(), authMode: draft.authMode }
		if (draft.authMode !== "headers") return base
		return { ...base, ...secretFields(draft.headers, stored?.headers ?? [], "headers", "deleteHeaders") }
	}
	const args = [...new Set(draft.args.map(({ value }) => value.trim()).filter((argument) => argument.length > 0))]
	return {
		transport: "stdio" as const,
		command: draft.command.trim(),
		args,
		...secretFields(draft.env, stored?.env ?? [], "env", "deleteEnv"),
	}
}

export type CreateResult = { ok: true; body: CreateMcpServerBody } | { ok: false; reason: DraftReason }
export type UpdateResult = { ok: true; body: UpdateMcpServerBody } | { ok: false; reason: DraftReason }

/**
 * Rows are added empty, so untouched rows never block saving. A value without a name goes nowhere
 * on either path; a name without a value only blocks creating, where there is nothing stored to keep.
 */
function secretRefused(rows: EnvVariable[], requireSecretValue: boolean): boolean {
	if (rows.some(({ name, value }) => !name.trim() && value)) return true
	return requireSecretValue && rows.some(({ name, value }) => name.trim() && !value)
}

function validate(draft: ConnectionDraft, requireSecretValue: boolean): DraftReason | undefined {
	if (!draft.name.trim()) return "nameRequired"
	if (draft.transport === "http") {
		if (!draft.url.trim()) return "addressRequired"
		if (draft.authMode === "headers" && secretRefused(draft.headers, requireSecretValue)) return "secretRequired"
	} else {
		if (!draft.command.trim()) return "commandRequired"
		if (secretRefused(draft.env, requireSecretValue)) return "secretRequired"
	}
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
	if (reason) return { ok: false, reason }
	return {
		ok: true,
		body: toUpdateBody({
			name: draft.name.trim(),
			revision: server.revision,
			isDisabled: server.isDisabled,
			server: serverOf(draft, server),
		}),
	}
}
