import { z } from "zod"

const DEFAULT_API_PORT = 3000
const MAX_PORT = 65_535

const envSchema = z.object({
	DATABASE_URL: z.url({
		protocol: /^postgres(ql)?$/,
		error: "DATABASE_URL must be a valid postgres:// connection string",
	}),
	TALQO_API_PORT: z.coerce.number().int().positive().max(MAX_PORT).default(DEFAULT_API_PORT),
	NODE_ENV: z.enum(["development", "production", "test"]),
})

export type Env = z.infer<typeof envSchema>

type EnvKey = keyof Env

export function parseEnv(source: Record<string, string | undefined>): Env {
	const result = envSchema.safeParse(source)
	if (!result.success) {
		throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`)
	}
	return result.data
}

// Validate only the key being read so consumers of one variable never
// require unrelated configuration to exist.
const cache = new Map<EnvKey, Env[EnvKey]>()

function read<K extends EnvKey>(key: K): Env[K] {
	if (!cache.has(key)) {
		const result = envSchema.shape[key].safeParse(process.env[key])
		if (!result.success) {
			throw new Error(`Invalid environment configuration:\n${formatFieldIssues(key, result.error)}`)
		}
		cache.set(key, result.data)
	}
	return cache.get(key) as Env[K]
}

function formatFieldIssues(key: EnvKey, error: z.ZodError): string {
	return error.issues.map((issue) => `✖ ${issue.message}\n  → at ${key}`).join("\n")
}

export const env: Env = {
	get DATABASE_URL() {
		return read("DATABASE_URL")
	},
	get TALQO_API_PORT() {
		return read("TALQO_API_PORT")
	},
	get NODE_ENV() {
		return read("NODE_ENV")
	},
}
