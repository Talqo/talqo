import { describe, expect, it } from "bun:test"

import { parseEnv } from "./env.ts"

describe("parseEnv", () => {
	it("accepts a valid configuration and defaults the port", () => {
		const env = parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo", NODE_ENV: "development" })

		expect(env.DATABASE_URL).toBe("postgres://talqo:talqo@127.0.0.1:5432/talqo")
		expect(env.TALQO_API_PORT).toBe(3000)
		expect(env.NODE_ENV).toBe("development")
	})

	it("rejects an invalid NODE_ENV", () => {
		expect(() =>
			parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo", NODE_ENV: "staging" }),
		).toThrow(/NODE_ENV/)
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

	it("defaults the file size and name length limits", () => {
		const env = parseEnv({ DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo", NODE_ENV: "development" })

		expect(env.TALQO_MAX_FILE_SIZE_MB).toBe(10)
		expect(env.TALQO_MAX_FILE_NAME_LENGTH).toBe(255)
	})

	it("accepts overridden file limits", () => {
		const env = parseEnv({
			DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo",
			NODE_ENV: "development",
			TALQO_MAX_FILE_SIZE_MB: "25",
			TALQO_MAX_FILE_NAME_LENGTH: "100",
		})

		expect(env.TALQO_MAX_FILE_SIZE_MB).toBe(25)
		expect(env.TALQO_MAX_FILE_NAME_LENGTH).toBe(100)
	})

	it("rejects a file name length above the storage limit of 255", () => {
		expect(() =>
			parseEnv({
				DATABASE_URL: "postgres://talqo:talqo@127.0.0.1:5432/talqo",
				NODE_ENV: "development",
				TALQO_MAX_FILE_NAME_LENGTH: "256",
			}),
		).toThrow(/TALQO_MAX_FILE_NAME_LENGTH/)
	})
})
