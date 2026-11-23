import { describe, expect, test } from "bun:test"

import {
	type AsyncStorage,
	CHAT_STORAGE_VERSION,
	createChatStorageKey,
	createMemoryStorage,
	createResilientStorage,
	readChatStorageRecord,
} from "./storage"

describe("chat storage", () => {
	test("falls back permanently to memory after a primary storage error", async () => {
		const primary: AsyncStorage = {
			getItem: () => Promise.reject(new Error("denied")),
			setItem: () => Promise.reject(new Error("denied")),
			removeItem: () => Promise.reject(new Error("denied")),
		}
		const failures: Array<unknown> = []
		const storage = createResilientStorage(primary, createMemoryStorage(), (error) => failures.push(error))

		expect(await storage.getItem("session")).toBeNull()
		await storage.setItem("session", "credential")

		expect(await storage.getItem("session")).toBe("credential")
		expect(failures).toHaveLength(1)
		expect(storage.isFallback()).toBe(true)
	})

	test("falls back silently when no fallback observer is configured", async () => {
		const primary: AsyncStorage = {
			getItem: () => Promise.reject(new Error("denied")),
			setItem: () => Promise.reject(new Error("denied")),
			removeItem: () => Promise.reject(new Error("denied")),
		}
		const storage = createResilientStorage(primary)

		expect(await storage.getItem("session")).toBeNull()
		expect(storage.isFallback()).toBe(true)
	})

	test("surfaces a failing fallback instead of switching to it again", async () => {
		let fallbackAttempts = 0
		const notifications: Array<unknown> = []
		const primary: AsyncStorage = {
			getItem: () => Promise.reject(new Error("denied")),
			setItem: () => Promise.reject(new Error("denied")),
			removeItem: () => Promise.reject(new Error("denied")),
		}
		const fallback: AsyncStorage = {
			getItem: async () => {
				fallbackAttempts += 1
				if (fallbackAttempts === 2) throw new Error("fallback broken")
				return `value-${fallbackAttempts}`
			},
			setItem: async () => {},
			removeItem: async () => {},
		}
		const storage = createResilientStorage(primary, fallback, (error) => notifications.push(error))

		expect(await storage.getItem("session")).toBe("value-1")
		await expect(storage.getItem("session")).rejects.toThrow("fallback broken")
		expect(fallbackAttempts).toBe(2)
		expect(notifications).toHaveLength(1)
	})

	test("builds an origin-and-token storage key", () => {
		expect(createChatStorageKey("https://api.example.test/", "embed token")).toBe(
			"talqo:chat:v1:https%3A%2F%2Fapi.example.test:embed%20token",
		)
		expect(createChatStorageKey("https://api.example.test", "embed token")).toBe(
			"talqo:chat:v1:https%3A%2F%2Fapi.example.test:embed%20token",
		)
	})

	test("parses valid records and rejects malformed or future records", () => {
		const valid = JSON.stringify({ version: CHAT_STORAGE_VERSION, credential: "secret" })
		const withPending = JSON.stringify({
			version: CHAT_STORAGE_VERSION,
			credential: "secret",
			pending: { requestId: "request", text: "hello" },
		})
		const cases = [
			{
				serialized: valid,
				expected: { version: CHAT_STORAGE_VERSION, credential: "secret" },
			},
			{
				serialized: withPending,
				expected: {
					version: CHAT_STORAGE_VERSION,
					credential: "secret",
					pending: { requestId: "request", text: "hello" },
				},
			},
			{
				serialized:
					'{"version":1,"credential":"secret","pending":{"requestId":"request","text":"hello","extra":true},"extra":true}',
				expected: {
					version: CHAT_STORAGE_VERSION,
					credential: "secret",
					pending: { requestId: "request", text: "hello", extra: true },
					extra: true,
				},
			},
			{ serialized: null, expected: null },
			{ serialized: "not-json", expected: null },
			{ serialized: "null", expected: null },
			{ serialized: "42", expected: null },
			{ serialized: '"text"', expected: null },
			{ serialized: "[]", expected: null },
			{ serialized: '{"version":2,"credential":"secret"}', expected: null },
			{ serialized: '{"version":"1","credential":"secret"}', expected: null },
			{ serialized: '{"credential":"secret"}', expected: null },
			{ serialized: '{"version":1}', expected: null },
			{ serialized: '{"version":1,"credential":42}', expected: null },
			{ serialized: '{"version":1,"pending":{"requestId":"id","text":"hello"}}', expected: null },
			{ serialized: '{"version":1,"credential":"secret","pending":null}', expected: null },
			{ serialized: '{"version":1,"credential":"secret","pending":"hello"}', expected: null },
			{ serialized: '{"version":1,"credential":"secret","pending":[]}', expected: null },
			{ serialized: '{"version":1,"credential":"secret","pending":{"text":"hello"}}', expected: null },
			{ serialized: '{"version":1,"credential":"secret","pending":{"requestId":42,"text":"hello"}}', expected: null },
			{ serialized: '{"version":1,"credential":"secret","pending":{"requestId":"id"}}', expected: null },
			{ serialized: '{"version":1,"credential":"secret","pending":{"requestId":"id","text":42}}', expected: null },
		] as const
		for (const { serialized, expected } of cases) {
			expect(readChatStorageRecord(serialized), String(serialized)).toEqual(expected)
		}
	})
})
