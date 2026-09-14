import { describe, expect, it } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseEnv } from "./env.ts"

const APP_SECRET = Buffer.alloc(32, 7).toString("base64url")

describe("parseEnv", () => {
	it("accepts a valid configuration and defaults the port", () => {
		const env = parseEnv({
			APP_SECRET,
			DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo",
			NODE_ENV: "development",
		})

		expect(env.DATABASE_URL).toBe("postgres://talqo:talqo@127.0.0.1:5432/talqo")
		expect(env.TALQO_API_PORT).toBe(3000)
		expect(env.NODE_ENV).toBe("development")
		expect(env.TALQO_CHAT_DAILY_MESSAGE_LIMIT).toBe(100)
		expect(env.TALQO_CHAT_MAX_CONCURRENT_GENERATIONS_PER_IP).toBe(2)
		expect(env.TALQO_TRUSTED_PROXY_CIDRS).toEqual([])
		expect(env.TALQO_RATE_LIMIT_IPV6_PREFIX_LENGTH).toBe(64)
		expect(env.TALQO_CHAT_MAX_INPUT_CHARACTERS).toBe(400_000)
		expect(env.TALQO_CHAT_MAX_OUTPUT_TOKENS).toBe(16_384)
		expect(env.TALQO_CHAT_GENERATION_TIMEOUT_SECONDS).toBe(120)
	})

	it("parses chat policy and trusted proxy CIDRs", () => {
		const env = parseEnv({
			APP_SECRET,
			DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo",
			NODE_ENV: "test",
			TALQO_CHAT_DAILY_MESSAGE_LIMIT: "7",
			TALQO_CHAT_MAX_CONCURRENT_GENERATIONS_PER_IP: "3",
			TALQO_TRUSTED_PROXY_CIDRS: "10.0.0.0/8, 2001:db8::/32",
			TALQO_RATE_LIMIT_IPV6_PREFIX_LENGTH: "96",
			TALQO_CHAT_MAX_INPUT_CHARACTERS: "1234",
			TALQO_CHAT_MAX_OUTPUT_TOKENS: "512",
			TALQO_CHAT_GENERATION_TIMEOUT_SECONDS: "9",
		})

		expect(env).toMatchObject({
			TALQO_CHAT_DAILY_MESSAGE_LIMIT: 7,
			TALQO_CHAT_MAX_CONCURRENT_GENERATIONS_PER_IP: 3,
			TALQO_TRUSTED_PROXY_CIDRS: ["10.0.0.0/8", "2001:db8::/32"],
			TALQO_RATE_LIMIT_IPV6_PREFIX_LENGTH: 96,
			TALQO_CHAT_MAX_INPUT_CHARACTERS: 1234,
			TALQO_CHAT_MAX_OUTPUT_TOKENS: 512,
			TALQO_CHAT_GENERATION_TIMEOUT_SECONDS: 9,
		})
	})

	it("rejects invalid chat policy, IPv6 prefixes, and proxy CIDRs", () => {
		const base = { DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo", NODE_ENV: "test" }
		expect(() => parseEnv({ ...base, TALQO_CHAT_DAILY_MESSAGE_LIMIT: "0" })).toThrow()
		expect(() => parseEnv({ ...base, TALQO_RATE_LIMIT_IPV6_PREFIX_LENGTH: "129" })).toThrow()
		expect(() => parseEnv({ ...base, TALQO_TRUSTED_PROXY_CIDRS: "not-a-cidr" })).toThrow()
	})

	it("rejects an invalid NODE_ENV", () => {
		expect(() =>
			parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo", NODE_ENV: "staging" }),
		).toThrow(/NODE_ENV/)
	})

	it("rejects a missing APP_SECRET because provider credentials and network hashes require it", () => {
		expect(() => parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo", NODE_ENV: "test" })).toThrow(
			/APP_SECRET/,
		)
	})

	it("rejects a missing APP_SECRET in production", () => {
		expect(() =>
			parseEnv({
				DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo",
				NODE_ENV: "production",
				TALQO_UPLOAD_DIR: "/data/talqo-uploads",
			}),
		).toThrow(/APP_SECRET/)
	})

	it("rejects an APP_SECRET shorter than 32 decoded bytes", () => {
		expect(() =>
			parseEnv({
				APP_SECRET: Buffer.alloc(31).toString("base64url"),
				DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo",
				NODE_ENV: "development",
			}),
		).toThrow(/APP_SECRET/)
	})

	it("rejects a non-base64url APP_SECRET", () => {
		expect(() =>
			parseEnv({
				APP_SECRET: "not+base64/value=",
				DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo",
				NODE_ENV: "development",
			}),
		).toThrow(/APP_SECRET/)
	})

	it("rejects the documented placeholder APP_SECRET", () => {
		expect(() =>
			parseEnv({
				APP_SECRET: "generate-me",
				DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo",
				NODE_ENV: "development",
			}),
		).toThrow(/APP_SECRET/)
	})

	it("rejects zero-filled APP_SECRET in production", () => {
		expect(() =>
			parseEnv({
				APP_SECRET: Buffer.alloc(32).toString("base64url"),
				DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo",
				NODE_ENV: "production",
				TALQO_UPLOAD_DIR: "/data/talqo-uploads",
			}),
		).toThrow(/APP_SECRET/)
	})

	it("rejects a missing TALQO_UPLOAD_DIR in production", () => {
		expect(() =>
			parseEnv({
				APP_SECRET,
				DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo",
				NODE_ENV: "production",
			}),
		).toThrow(/TALQO_UPLOAD_DIR/)
	})

	it("rejects a missing NODE_ENV", () => {
		expect(() => parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo" })).toThrow(/NODE_ENV/)
	})

	it("defaults TALQO_UPLOAD_DIR to a talqo directory in the OS temp dir", () => {
		const env = parseEnv({
			APP_SECRET,
			DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo",
			NODE_ENV: "development",
		})

		expect(env.TALQO_UPLOAD_DIR).toBe(join(tmpdir(), "talqo"))
	})

	it("rejects a missing DATABASE_URL", () => {
		expect(() => parseEnv({ NODE_ENV: "development" })).toThrow(/DATABASE_URL/)
	})

	it("rejects an invalid DATABASE_URL", () => {
		expect(() => parseEnv({ DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/)
	})
})
