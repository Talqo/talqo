import { describe, expect, test } from "bun:test"

import { parseBlacklist } from "./blacklist"

describe("parseBlacklist", () => {
	test("splits comma-separated words", () => {
		expect(parseBlacklist("spam,abuse,scam")).toEqual(["spam", "abuse", "scam"])
	})

	test("trims whitespace around words", () => {
		expect(parseBlacklist("  spam , abuse\t")).toEqual(["spam", "abuse"])
	})

	test("drops empty entries", () => {
		expect(parseBlacklist("spam,, ,abuse,")).toEqual(["spam", "abuse"])
	})

	test("deduplicates words", () => {
		expect(parseBlacklist("spam,spam,SPAM")).toEqual(["spam", "SPAM"])
	})

	test("returns an empty list for empty input", () => {
		expect(parseBlacklist("")).toEqual([])
		expect(parseBlacklist(" , , ")).toEqual([])
	})
})
