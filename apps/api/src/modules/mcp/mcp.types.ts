const MS_PER_SECOND = 1_000
const SECONDS_TEN = 10
const MINUTES_PER_HOUR = 60

export const MCP_SERVER_NAME_MAX_LENGTH = 80
export const MAX_TOOL_DESCRIPTION_CHARACTERS = 1 * MS_PER_SECOND
export const MAX_STDIO_CONNECT_MS = SECONDS_TEN * MS_PER_SECOND
export const OAUTH_STATE_TTL_MS = SECONDS_TEN * MINUTES_PER_HOUR * MS_PER_SECOND

/** Operator-chosen programs inherit these and nothing else, so Talqo secrets stay unreadable. */
export const STDIO_INHERITED_ENV = ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"]

export type McpToolSnapshot = {
	description: string
	name: string
	selected: boolean
}

export type McpHttpInput = {
	authMode: McpAuthMode
	headers?: Record<string, string>
	transport: "http"
	url: string
}

export type McpStdioInput = {
	args?: string[]
	command: string
	env?: Record<string, string>
	transport: "stdio"
}

export type McpCreateInput = { name: string } & (McpHttpInput | McpStdioInput)
export type McpUpdateInput = McpCreateInput & {
	expectedRevision: number
	isDisabled?: boolean
	tools?: { name: string; selected: boolean }[]
}

/** Secrets never leave the service; responses carry names and a presence flag instead. */
export type McpSecretName = { hasValue: boolean; name: string }

type McpTransport = "http" | "stdio"
type McpAuthMode = "none" | "headers" | "oauth"

export type McpServerView = {
	args: string[]
	authMode: McpAuthMode | null
	command: string | null
	env: McpSecretName[]
	headers: McpSecretName[]
	isWorking: boolean
	id: string
	isDisabled: boolean
	name: string
	revision: number
	toolCount: number
	tools: McpToolSnapshot[]
	transport: McpTransport
	url: string | null
}
