import { z } from "zod"

const DEFAULT_API_PORT = 3000
const MAX_PORT = 65_535
const DEFAULT_MAX_FILE_SIZE_MB = 10
// eslint-disable-next-line no-magic-numbers
export const BYTES_PER_MB = 1024 * 1024
// agent_file.original_name is a text column; 255 keeps stored names portable and cheap to validate.
const MAX_FILE_NAME_LENGTH = 255
const DEFAULT_MAX_FILE_NAME_LENGTH = MAX_FILE_NAME_LENGTH

const envSchema = z.object({
	DATABASE_URL: z.url({
		protocol: /^postgres(ql)?$/,
		error: "DATABASE_URL must be a valid postgres:// connection string",
	}),
	TALQO_API_PORT: z.coerce.number().int().positive().max(MAX_PORT).default(DEFAULT_API_PORT),
	TALQO_UPLOAD_DIR: z.string().min(1).default("data/uploads"),
	TALQO_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(DEFAULT_MAX_FILE_SIZE_MB),
	TALQO_MAX_FILE_NAME_LENGTH: z.coerce
		.number()
		.int()
		.positive()
		.max(MAX_FILE_NAME_LENGTH)
		.default(DEFAULT_MAX_FILE_NAME_LENGTH),
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
	get TALQO_MAX_FILE_SIZE_MB() {
		return load().TALQO_MAX_FILE_SIZE_MB
	},
	get TALQO_MAX_FILE_NAME_LENGTH() {
		return load().TALQO_MAX_FILE_NAME_LENGTH
	},
	get NODE_ENV() {
		return load().NODE_ENV
	},
}
