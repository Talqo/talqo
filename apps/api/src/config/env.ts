import { z } from "zod"

const envSchema = z.object({
	DATABASE_URL: z.url({
		protocol: /^postgres(ql)?$/,
		error: "DATABASE_URL must be a valid postgres:// connection string",
	}),
	TALQO_API_PORT: z.coerce.number().int().positive().max(65535).default(3000),
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
}
