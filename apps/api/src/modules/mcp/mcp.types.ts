const MS_PER_SECOND = 1_000
const SECONDS_TEN = 10
const TOOL_RESULT_BUDGET_CHARACTERS = 8_000
const TOOL_LIST_TIMEOUT_SECONDS = 15

export const MCP_SERVER_NAME_MAX_LENGTH = 80
export const MAX_TOOL_DESCRIPTION_CHARACTERS = 1 * MS_PER_SECOND
export const MAX_TOOL_RESULT_CHARACTERS = TOOL_RESULT_BUDGET_CHARACTERS
export const MAX_STDIO_CONNECT_MS = SECONDS_TEN * MS_PER_SECOND
export const TOOL_LIST_TIMEOUT_MS = TOOL_LIST_TIMEOUT_SECONDS * MS_PER_SECOND
export const MAX_TOOL_LIST_PAGES = 20
export const MAX_TOOLS_PER_SERVER = 200

/** Operator-chosen programs inherit these and nothing else, so Talqo secrets stay unreadable. */
export const STDIO_INHERITED_ENV = ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"]

export type McpToolSnapshot = {
	description: string
	name: string
	selected: boolean
}

export type McpHttpInput = {
	authMode: McpAuthMode
	deleteHeaders?: string[]
	headers?: Record<string, string>
	transport: "http"
	url: string
}

export type McpStdioInput = {
	args?: string[]
	command: string
	deleteEnv?: string[]
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
type McpAuthMode = "none" | "headers"

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
