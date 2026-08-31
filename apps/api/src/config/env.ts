import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

const DEFAULT_API_PORT = 3000
const MAX_PORT = 65_535
const MIN_APP_SECRET_BYTES = 32

// Ephemeral dev/test default (/tmp/talqo on Linux); production must set
// TALQO_UPLOAD_DIR explicitly — see docs/adr/0012-agent-upload-storage.md.
const DEFAULT_UPLOAD_DIR = join(tmpdir(), "talqo")

const appSecretSchema = z
	.string()
	.regex(/^[A-Za-z0-9_-]+$/, "APP_SECRET must be base64url encoded")
	.refine((value) => Buffer.from(value, "base64url").byteLength >= MIN_APP_SECRET_BYTES, {
		error: `APP_SECRET must decode to at least ${MIN_APP_SECRET_BYTES} bytes`,
	})

const envSchema = z
	.object({
		APP_SECRET: appSecretSchema.optional(),
		DATABASE_URL: z.url({
			protocol: /^postgres(ql)?$/,
			error: "DATABASE_URL must be a valid postgres:// connection string",
		}),
		TALQO_API_PORT: z.coerce.number().int().positive().max(MAX_PORT).default(DEFAULT_API_PORT),
		TALQO_UPLOAD_DIR: z.string().min(1).optional(),
		NODE_ENV: z.enum(["development", "production", "test"]),
	})
	.superRefine((env, context) => {
		if (env.NODE_ENV !== "production") return
		if (!env.APP_SECRET) {
			context.addIssue({
				code: "custom",
				path: ["APP_SECRET"],
				message: "APP_SECRET is required in production",
			})
		} else if (Buffer.from(env.APP_SECRET, "base64url").every((byte) => byte === 0)) {
			context.addIssue({
				code: "custom",
				path: ["APP_SECRET"],
				message: "APP_SECRET must not be zero-filled in production",
			})
		}
		if (!env.TALQO_UPLOAD_DIR) {
			context.addIssue({
				code: "custom",
				path: ["TALQO_UPLOAD_DIR"],
				message: "TALQO_UPLOAD_DIR is required in production",
			})
		}
	})

export type Env = Omit<z.infer<typeof envSchema>, "TALQO_UPLOAD_DIR"> & { TALQO_UPLOAD_DIR: string }

export function parseEnv(source: Record<string, string | undefined>): Env {
	const result = envSchema.safeParse(source)
	if (!result.success) {
		throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`)
	}
	// The default is applied after superRefine so production without TALQO_UPLOAD_DIR fails boot.
	return { ...result.data, TALQO_UPLOAD_DIR: result.data.TALQO_UPLOAD_DIR ?? DEFAULT_UPLOAD_DIR }
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
	get TALQO_UPLOAD_DIR() {
		return load().TALQO_UPLOAD_DIR
	},
	get NODE_ENV() {
		return load().NODE_ENV
	},
}
