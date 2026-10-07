export const MCP_ENV_VARIABLE_LIMIT = 20

/** Rows carry a stable id so removing one never scrambles the inputs being typed. */
export type EnvVariable = { id: string; name: string; value: string }

/** Only rows with both halves are sent; a blank value means leave the stored one alone. */
export function toEnvRecord(env: EnvVariable[]): Record<string, string> {
	return Object.fromEntries(
		env.filter(({ name, value }) => name.trim() && value).map(({ name, value }) => [name.trim(), value]),
	)
}
