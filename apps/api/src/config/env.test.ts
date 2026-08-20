import { describe, expect, it } from "bun:test"

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

	it("rejects a missing APP_SECRET", () => {
		expect(() =>
			parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo", NODE_ENV: "development" }),
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

	it("rejects a missing NODE_ENV", () => {
		expect(() => parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo" })).toThrow(/NODE_ENV/)
	})

	it("rejects a missing DATABASE_URL", () => {
		expect(() => parseEnv({ NODE_ENV: "development" })).toThrow(/DATABASE_URL/)
	})

	it("rejects an invalid DATABASE_URL", () => {
		expect(() => parseEnv({ DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/)
	})
})
