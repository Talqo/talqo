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
	})

	it("rejects an invalid NODE_ENV", () => {
		expect(() =>
			parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo", NODE_ENV: "staging" }),
		).toThrow(/NODE_ENV/)
	})

	it("allows a missing APP_SECRET outside production", () => {
		const env = parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo", NODE_ENV: "test" })

		expect(env.APP_SECRET).toBeUndefined()
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
		const env = parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo", NODE_ENV: "development" })

		expect(env.TALQO_UPLOAD_DIR).toBe(join(tmpdir(), "talqo"))
	})

	it("rejects a missing DATABASE_URL", () => {
		expect(() => parseEnv({ NODE_ENV: "development" })).toThrow(/DATABASE_URL/)
	})

	it("rejects an invalid DATABASE_URL", () => {
		expect(() => parseEnv({ DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/)
	})
})
