import { describe, expect, it } from "bun:test"

import { normalizeBlacklist } from "./agent.service.ts"

describe("normalizeBlacklist", () => {
	it("trims surrounding whitespace", () => {
		expect(normalizeBlacklist(["  spam ", "\tabuse\n"])).toEqual(["spam", "abuse"])
	})

	it("drops blank entries", () => {
		expect(normalizeBlacklist(["spam", "", "   ", "abuse"])).toEqual(["spam", "abuse"])
	})

	it("deduplicates so a repeated word cannot violate the unique index", () => {
		expect(normalizeBlacklist(["spam", "spam", " spam "])).toEqual(["spam"])
	})

	it("treats case as significant, matching the unique index", () => {
		expect(normalizeBlacklist(["spam", "SPAM"])).toEqual(["spam", "SPAM"])
	})

	it("returns an empty list for empty input", () => {
		expect(normalizeBlacklist([])).toEqual([])
		expect(normalizeBlacklist([" ", ""])).toEqual([])
	})
})
