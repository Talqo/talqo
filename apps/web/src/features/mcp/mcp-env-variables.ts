export const MCP_ENV_VARIABLE_LIMIT = 20

export type EnvVariable = { name: string; value: string }

export type AddEnvResult =
	| { ok: true; variable: EnvVariable; env: EnvVariable[] }
	| { ok: false; reason: "duplicate" | "emptyName" | "limit" }

export function addEnvVariable(env: EnvVariable[], input: EnvVariable): AddEnvResult {
	const name = input.name.trim()
	if (!name) return { ok: false, reason: "emptyName" }
	if (env.some((existing) => existing.name === name)) return { ok: false, reason: "duplicate" }
	if (env.length >= MCP_ENV_VARIABLE_LIMIT) return { ok: false, reason: "limit" }
	return { ok: true, variable: { name, value: input.value }, env: [...env, { name, value: input.value }] }
}

export function removeEnvVariable(env: EnvVariable[], name: string): EnvVariable[] {
	return env.filter((existing) => existing.name !== name)
}

/** Only rows with both halves are sent; a blank value means leave the stored one alone. */
export function toEnvRecord(env: EnvVariable[]): Record<string, string> {
	return Object.fromEntries(
		env.filter(({ name, value }) => name.trim() && value).map(({ name, value }) => [name.trim(), value]),
	)
}
