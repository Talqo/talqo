import ipaddr from "ipaddr.js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

const DEFAULT_API_PORT = 3000
const MAX_PORT = 65_535
const MIN_APP_SECRET_BYTES = 32
export const MAX_CHAT_INPUT_CHARACTERS = 400_000
const DEFAULT_CHAT_DAILY_MESSAGE_LIMIT = 100
const DEFAULT_CHAT_CONCURRENCY_LIMIT = 2
const MAX_IPV6_PREFIX_LENGTH = 128
const DEFAULT_IPV6_PREFIX_LENGTH = 64
const DEFAULT_CHAT_MAX_OUTPUT_TOKENS = 16_384
const DEFAULT_CHAT_GENERATION_TIMEOUT_SECONDS = 120
const MAX_CHAT_GENERATION_TIMEOUT_SECONDS = 300

const DEFAULT_UPLOAD_DIR = join(tmpdir(), "talqo")

const positiveSafeInteger = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const trustedCidrsSchema = z
	.string()
	.default("")
	.transform((value, context) => {
		const cidrs = value
			.split(",")
			.map((cidr) => cidr.trim())
			.filter(Boolean)
		try {
			for (const cidr of cidrs) ipaddr.parseCIDR(cidr)
		} catch {
			context.addIssue({ code: "custom", message: "TALQO_TRUSTED_PROXY_CIDRS must contain valid CIDRs" })
			return z.NEVER
		}
		return cidrs
	})

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
		TALQO_CHAT_DAILY_MESSAGE_LIMIT: positiveSafeInteger.default(DEFAULT_CHAT_DAILY_MESSAGE_LIMIT),
		TALQO_CHAT_MAX_CONCURRENT_GENERATIONS_PER_IP: positiveSafeInteger.default(DEFAULT_CHAT_CONCURRENCY_LIMIT),
		TALQO_TRUSTED_PROXY_CIDRS: trustedCidrsSchema,
		TALQO_RATE_LIMIT_IPV6_PREFIX_LENGTH: z.coerce
			.number()
			.int()
			.min(1)
			.max(MAX_IPV6_PREFIX_LENGTH)
			.default(DEFAULT_IPV6_PREFIX_LENGTH),
		TALQO_CHAT_MAX_INPUT_CHARACTERS: positiveSafeInteger
			.max(MAX_CHAT_INPUT_CHARACTERS)
			.default(MAX_CHAT_INPUT_CHARACTERS),
		TALQO_CHAT_MAX_OUTPUT_TOKENS: positiveSafeInteger.default(DEFAULT_CHAT_MAX_OUTPUT_TOKENS),
		TALQO_CHAT_GENERATION_TIMEOUT_SECONDS: positiveSafeInteger
			.max(MAX_CHAT_GENERATION_TIMEOUT_SECONDS)
			.default(DEFAULT_CHAT_GENERATION_TIMEOUT_SECONDS),
		TALQO_API_PORT: z.coerce.number().int().positive().max(MAX_PORT).default(DEFAULT_API_PORT),
		TALQO_UPLOAD_DIR: z.string().min(1).optional(),
		NODE_ENV: z.enum(["development", "production", "test"]),
	})
	.superRefine((env, context) => {
		if (env.NODE_ENV !== "production") return
		if (Buffer.from(env.APP_SECRET, "base64url").every((byte) => byte === 0)) {
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
	get TALQO_CHAT_DAILY_MESSAGE_LIMIT() {
		return load().TALQO_CHAT_DAILY_MESSAGE_LIMIT
	},
	get TALQO_CHAT_MAX_CONCURRENT_GENERATIONS_PER_IP() {
		return load().TALQO_CHAT_MAX_CONCURRENT_GENERATIONS_PER_IP
	},
	get TALQO_TRUSTED_PROXY_CIDRS() {
		return load().TALQO_TRUSTED_PROXY_CIDRS
	},
	get TALQO_RATE_LIMIT_IPV6_PREFIX_LENGTH() {
		return load().TALQO_RATE_LIMIT_IPV6_PREFIX_LENGTH
	},
	get TALQO_CHAT_MAX_INPUT_CHARACTERS() {
		return load().TALQO_CHAT_MAX_INPUT_CHARACTERS
	},
	get TALQO_CHAT_MAX_OUTPUT_TOKENS() {
		return load().TALQO_CHAT_MAX_OUTPUT_TOKENS
	},
	get TALQO_CHAT_GENERATION_TIMEOUT_SECONDS() {
		return load().TALQO_CHAT_GENERATION_TIMEOUT_SECONDS
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
