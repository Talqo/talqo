import { describe, expect, test } from "bun:test"

import { addBlacklistTerm, BLACKLIST_TERM_LIMIT, removeBlacklistTerm } from "./blacklist-terms"

describe("addBlacklistTerm", () => {
	test("appends a trimmed term", () => {
		expect(addBlacklistTerm(["spam"], " abuse ")).toEqual({ ok: true, term: "abuse", terms: ["spam", "abuse"] })
	})

	test("rejects an empty or whitespace-only term", () => {
		expect(addBlacklistTerm([], "   ")).toEqual({ ok: false, reason: "empty" })
	})

	test("rejects duplicates case-insensitively", () => {
		expect(addBlacklistTerm(["Spam"], "SPAM")).toEqual({ ok: false, reason: "duplicate" })
		expect(addBlacklistTerm(["spam"], "spam")).toEqual({ ok: false, reason: "duplicate" })
	})

	test("rejects terms beyond the limit", () => {
		const full = Array.from({ length: BLACKLIST_TERM_LIMIT }, (_, index) => `word${index}`)
		expect(addBlacklistTerm(full, "overflow")).toEqual({ ok: false, reason: "limit" })
	})

	test("spots duplicates even when the list is at the limit", () => {
		const full = Array.from({ length: BLACKLIST_TERM_LIMIT }, (_, index) => `word${index}`)
		expect(addBlacklistTerm(full, "word0")).toEqual({ ok: false, reason: "duplicate" })
	})
})

describe("removeBlacklistTerm", () => {
	test("removes the exact term", () => {
		expect(removeBlacklistTerm(["spam", "abuse"], "spam")).toEqual(["abuse"])
	})

	test("removes case-insensitively, matching add dedupe", () => {
		expect(removeBlacklistTerm(["Spam", "abuse"], "spam")).toEqual(["abuse"])
		expect(removeBlacklistTerm(["spam", "abuse"], "SPAM")).toEqual(["abuse"])
	})
})
