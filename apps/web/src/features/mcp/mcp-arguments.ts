/** Mirrored by the API's MAX_ARGS; the server rejects anything beyond it. */
export const MCP_ARGUMENT_LIMIT = 50

/** Rows carry a stable id so removing one never scrambles the inputs being typed. */
export type ArgumentRow = { id: string; value: string }
