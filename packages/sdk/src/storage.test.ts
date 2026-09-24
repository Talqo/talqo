import { describe, expect, test } from "bun:test"

import {
	CHAT_STORAGE_VERSION,
	createChatStorageKey,
	createMemoryStorage,
	createResilientStorage,
	readChatStorageRecord,
	type AsyncStorage,
} from "./storage"

describe("chat storage", () => {
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
