import { describe, expect, it } from "bun:test"

import { parseEnv } from "./env.ts"

describe("parseEnv", () => {
	it("accepts a valid configuration and defaults the port", () => {
		const env = parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo" })

		expect(env.DATABASE_URL).toBe("postgres://talqo:talqo@127.0.0.1:5432/talqo")
		expect(env.TALQO_API_PORT).toBe(3000)
		expect(env.NODE_ENV).toBe("development")
	})

	it("rejects an invalid NODE_ENV", () => {
		expect(() =>
			parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo", NODE_ENV: "staging" }),
		).toThrow(/NODE_ENV/)
	})

	it("rejects a missing DATABASE_URL", () => {
		expect(() => parseEnv({})).toThrow(/DATABASE_URL/)
	})

	it("rejects an invalid DATABASE_URL", () => {
		expect(() => parseEnv({ DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/)
	})
})
