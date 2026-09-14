import { describe, expect, test } from "bun:test"

import {
	CHAT_STORAGE_VERSION,
	createChatStorageKey,
	createLazyLocalStorage,
	createMemoryStorage,
	createResilientStorage,
	readChatStorageRecord,
	type AsyncStorage,
} from "./storage"

describe("chat storage", () => {
	test("stores values in memory and isolates keys", async () => {
		const storage = createMemoryStorage()
		await storage.setItem("first", "one")
		await storage.setItem("second", "two")

		expect(await storage.getItem("first")).toBe("one")
		await storage.removeItem("first")
		expect(await storage.getItem("first")).toBeNull()
		expect(await storage.getItem("second")).toBe("two")
	})

	test("does not resolve localStorage until an operation runs", async () => {
		let resolutions = 0
		const storage = createLazyLocalStorage(() => {
			resolutions += 1
			throw new Error("unavailable")
		})

		expect(resolutions).toBe(0)
		await expect(storage.getItem("key")).rejects.toThrow("unavailable")
		expect(resolutions).toBe(1)
	})

	test("falls back permanently to memory after a primary storage error", async () => {
		const primary: AsyncStorage = {
			getItem: () => Promise.reject(new Error("denied")),
			setItem: () => Promise.reject(new Error("denied")),
			removeItem: () => Promise.reject(new Error("denied")),
		}
		const failures: unknown[] = []
		const storage = createResilientStorage(primary, createMemoryStorage(), (error) => failures.push(error))

		expect(await storage.getItem("session")).toBeNull()
		await storage.setItem("session", "credential")

		expect(await storage.getItem("session")).toBe("credential")
		expect(failures).toHaveLength(1)
		expect(storage.isFallback()).toBe(true)
	})

	test("uses an origin-and-token key and rejects malformed or future records", () => {
		expect(createChatStorageKey("https://api.example.test/", "embed token")).toBe(
			"talqo:chat:v1:https%3A%2F%2Fapi.example.test:embed%20token",
		)
		expect(readChatStorageRecord(JSON.stringify({ version: CHAT_STORAGE_VERSION, credential: "secret" }))).toEqual({
			version: CHAT_STORAGE_VERSION,
			credential: "secret",
		})
		expect(
			readChatStorageRecord(
				JSON.stringify({
					version: CHAT_STORAGE_VERSION,
					credential: "secret",
					pending: { requestId: "request", text: "hello" },
				}),
			),
		).toEqual({
			version: CHAT_STORAGE_VERSION,
			credential: "secret",
			pending: { requestId: "request", text: "hello" },
		})
		expect(readChatStorageRecord('{"version":2,"credential":"secret"}')).toBeNull()
		expect(readChatStorageRecord('{"version":1,"pending":{"requestId":"id","text":"hello"}}')).toBeNull()
		expect(readChatStorageRecord("not-json")).toBeNull()
	})
})
