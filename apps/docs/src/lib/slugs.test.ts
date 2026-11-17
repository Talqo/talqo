import { describe, expect, test } from "bun:test"

import { isValidSlugPath, splitSlugPath } from "./slugs"

describe("isValidSlugPath", () => {
	test("accepts bounded non-empty string segments", () => {
		expect(isValidSlugPath([])).toBe(true)
		expect(isValidSlugPath(["deployment"])).toBe(true)
		expect(isValidSlugPath(Array.from({ length: 32 }, (_, index) => `page-${index}`))).toBe(true)
		expect(isValidSlugPath(["x".repeat(256)])).toBe(true)
	})

	test("rejects non-arrays", () => {
		expect(isValidSlugPath(undefined)).toBe(false)
		expect(isValidSlugPath(null)).toBe(false)
		expect(isValidSlugPath("deployment")).toBe(false)
		expect(isValidSlugPath(42)).toBe(false)
	})

	test("rejects empty, oversized, and non-string segments", () => {
		expect(isValidSlugPath([""])).toBe(false)
		expect(isValidSlugPath(["x".repeat(257)])).toBe(false)
		expect(isValidSlugPath(Array.from({ length: 33 }, (_, index) => `page-${index}`))).toBe(false)
		expect(isValidSlugPath(["deployment", 7])).toBe(false)
	})
})

describe("splitSlugPath", () => {
	test("splits a path into non-empty segments", () => {
		expect(splitSlugPath("guides/deployment")).toEqual(["guides", "deployment"])
		expect(splitSlugPath("/guides/deployment/")).toEqual(["guides", "deployment"])
		expect(splitSlugPath("guides//deployment")).toEqual(["guides", "deployment"])
	})

	test("returns no segments for a missing or empty path", () => {
		expect(splitSlugPath(undefined)).toEqual([])
		expect(splitSlugPath("")).toEqual([])
		expect(splitSlugPath("/")).toEqual([])
	})
})
