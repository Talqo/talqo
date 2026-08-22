import { z } from "zod"

const DEFAULT_API_PORT = 3000
const MAX_PORT = 65_535
const MIN_APP_SECRET_BYTES = 32

const appSecretSchema = z
	.string()
	.regex(/^[A-Za-z0-9_-]+$/, "APP_SECRET must be base64url encoded")
	.refine((value) => Buffer.from(value, "base64url").byteLength >= MIN_APP_SECRET_BYTES, {
		error: `APP_SECRET must decode to at least ${MIN_APP_SECRET_BYTES} bytes`,
	})

const envSchema = z
	.object({
		APP_SECRET: appSecretSchema,
		DATABASE_URL: z.url({
			protocol: /^postgres(ql)?$/,
			error: "DATABASE_URL must be a valid postgres:// connection string",
		}),
		TALQO_API_PORT: z.coerce.number().int().positive().max(MAX_PORT).default(DEFAULT_API_PORT),
		NODE_ENV: z.enum(["development", "production", "test"]),
	})
	.superRefine((env, context) => {
		if (env.NODE_ENV === "production" && Buffer.from(env.APP_SECRET, "base64url").every((byte) => byte === 0)) {
			context.addIssue({
				code: "custom",
				path: ["APP_SECRET"],
				message: "APP_SECRET must not be zero-filled in production",
			})
		}
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
	get APP_SECRET() {
		return load().APP_SECRET
	},
	get DATABASE_URL() {
		return load().DATABASE_URL
	},
	get TALQO_API_PORT() {
		return load().TALQO_API_PORT
	},
	get NODE_ENV() {
		return load().NODE_ENV
	},
}
