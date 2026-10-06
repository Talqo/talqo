import type { CreateMcpServerBody } from "@/api/generated/models/mcp/createMcpServerBody.zod"
import type { UpdateMcpServerBody } from "@/api/generated/models/mcp/updateMcpServerBody.zod"
import type { McpServer } from "@/api/generated/models/mcpServer.zod"

/**
 * Rebuilds an update body from a server whose secrets came back masked. Header and environment
 * values are deliberately omitted: sending them would send `{}` and erase what is stored, so an
 * update that does not touch a secret must not mention it.
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
	authMode: "none" | "headers" | "oauth"
	command: string
	args: string
	headerName: string
	headerValue: string
	envName: string
	envValue: string
}

export const EMPTY_DRAFT: ConnectionDraft = {
	name: "",
	transport: "http",
	url: "",
	authMode: "none",
	command: "",
	args: "",
	headerName: "",
	headerValue: "",
	envName: "",
	envValue: "",
}

/** One blank line per argument, so no quoting rules exist and nothing is silently word-split. */
export function parseArgs(args: string): string[] {
	return args
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
}

export type DraftReason = "nameRequired" | "addressRequired" | "commandRequired" | "secretRequired"

export type DraftResult = { ok: true; body: CreateMcpServerBody } | { ok: false; reason: DraftReason }

export function toCreateBody(draft: ConnectionDraft): DraftResult {
	if (!draft.name.trim()) return { ok: false, reason: "nameRequired" }
	if (draft.transport === "http") {
		if (!draft.url.trim()) return { ok: false, reason: "addressRequired" }
		if (draft.authMode === "headers" && !(draft.headerName.trim() && draft.headerValue))
			return { ok: false, reason: "secretRequired" }
		return {
			ok: true,
			body: {
				name: draft.name.trim(),
				server: {
					transport: "http",
					url: draft.url.trim(),
					authMode: draft.authMode,
					...(draft.authMode === "headers" ? { headers: { [draft.headerName.trim()]: draft.headerValue } } : {}),
				},
			},
		}
	}
	if (!draft.command.trim()) return { ok: false, reason: "commandRequired" }
	if ((draft.envName.trim() !== "") !== Boolean(draft.envValue)) return { ok: false, reason: "secretRequired" }
	return {
		ok: true,
		body: {
			name: draft.name.trim(),
			server: {
				transport: "stdio",
				command: draft.command.trim(),
				args: parseArgs(draft.args),
				...(draft.envName.trim() ? { env: { [draft.envName.trim()]: draft.envValue } } : {}),
			},
		},
	}
}
