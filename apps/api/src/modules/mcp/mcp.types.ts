export const MCP_SERVER_NAME_MAX_LENGTH = 80
export const MAX_TOOL_DESCRIPTION_CHARACTERS = 1000
export const MAX_TOOL_RESULT_CHARACTERS = 8000
export const MAX_STDIO_CONNECT_MS = 10_000
export const TOOL_LIST_TIMEOUT_MS = 15_000

/** Operator-chosen programs inherit these and nothing else, so Talqo secrets stay unreadable. */
export const STDIO_INHERITED_ENV = ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"]

export type McpToolSnapshot = {
	description: string
	enabled: boolean
	name: string
}

export type McpHttpInput = {
	authMode: McpAuthMode
	deleteHeaders?: Array<string>
	headers?: Record<string, string>
	transport: "http"
	url: string
}

export type McpStdioInput = {
	args?: Array<string>
	command: string
	deleteEnv?: Array<string>
	env?: Record<string, string>
	transport: "stdio"
}

export type McpCreateInput = { name: string } & (McpHttpInput | McpStdioInput)
export type McpUpdateInput = McpCreateInput & {
	expectedRevision: number
	tools?: Array<{ enabled: boolean; name: string }>
}

/** Secrets never leave the service; responses carry names and a presence flag instead. */
export type McpSecretName = { hasValue: boolean; name: string }

type McpTransport = "http" | "stdio"
type McpAuthMode = "none" | "headers"

export type McpServerView = {
	args: Array<string>
	authMode: McpAuthMode | null
	command: string | null
	env: Array<McpSecretName>
	headers: Array<McpSecretName>
	isWorking: boolean
	id: string
	isDisabled: boolean
	name: string
	revision: number
	toolCount: number
	tools: Array<McpToolSnapshot>
	transport: McpTransport
	url: string | null
}
