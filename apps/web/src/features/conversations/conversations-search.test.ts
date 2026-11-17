import { describe, expect, test } from "bun:test"

import { parseConversationsSearch } from "./conversations-search.ts"

describe("parseConversationsSearch", () => {
	test("accepts numeric pages after the first page", () => {
		expect(parseConversationsSearch({ page: 2 })).toEqual({ agents: undefined, page: 2 })
		expect(parseConversationsSearch({ page: "3" })).toEqual({ agents: undefined, page: 3 })
	})

	test("omits first, fractional, and non-numeric pages", () => {
		for (const page of [1, 1.5, "invalid"]) {
			expect(parseConversationsSearch({ page }).page).toBeUndefined()
		}
	})

	test("decodes a JSON-encoded agent id list", () => {
		expect(parseConversationsSearch({ agents: JSON.stringify(["agent-a", "agent-b"]) })).toEqual({
			agents: ["agent-a", "agent-b"],
			page: undefined,
		})
	})
})
