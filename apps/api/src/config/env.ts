import { z } from "zod"

const DEFAULT_API_PORT = 3000
const MAX_PORT = 65_535

const envSchema = z.object({
	DATABASE_URL: z.url({
		protocol: /^postgres(ql)?$/,
		error: "DATABASE_URL must be a valid postgres:// connection string",
	}),
	TALQO_API_PORT: z.coerce.number().int().positive().max(MAX_PORT).default(DEFAULT_API_PORT),
	// Dev default only. Production sets TALQO_UPLOAD_DIR to whatever persistent path
	// its deployment provides (the env var is the contract; the path is ops' decision).
	TALQO_UPLOAD_DIR: z.string().min(1).default("/tmp/talqo-uploads"),
	NODE_ENV: z.enum(["development", "production", "test"]),
})

export type Env = z.infer<typeof envSchema>

export function parseEnv(source: Record<string, string | undefined>): Env {
	const result = envSchema.safeParse(source)
	if (!result.success) {
		throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`)
	}
	return result.data
}

let cached: Env | undefined
function load(): Env {
	return (cached ??= parseEnv(process.env))
}

export const env: Env = {
	get DATABASE_URL() {
		return load().DATABASE_URL
	},
	get TALQO_API_PORT() {
		return load().TALQO_API_PORT
	},
	get TALQO_UPLOAD_DIR() {
		return load().TALQO_UPLOAD_DIR
	},
	get NODE_ENV() {
		return load().NODE_ENV
	},
}
