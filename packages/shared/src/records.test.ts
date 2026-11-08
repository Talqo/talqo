import { describe, expect, test } from "bun:test"

import { sameStringRecord } from "./records"

describe("sameStringRecord", () => {
	test("ignores key order", () => {
		expect(
			sameStringRecord(
				{ baseURL: "https://example.test", model: "chat" },
				{ model: "chat", baseURL: "https://example.test" },
			),
		).toBe(true)
	})

	test("compares every value", () => {
		expect(sameStringRecord({ model: "chat" }, { model: "embedding" })).toBe(false)
		expect(sameStringRecord({ model: "chat" }, { model: "chat", baseURL: "https://example.test" })).toBe(false)
	})
})
