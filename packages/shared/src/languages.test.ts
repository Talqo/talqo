import { describe, expect, test } from "bun:test"

import { isSupportedLanguage } from "./languages"

describe("isSupportedLanguage", () => {
	test.each([
		{ value: "en", expected: true },
		{ value: "cs", expected: true },
		{ value: "fr", expected: false },
		{ value: "EN", expected: false },
		{ value: "constructor", expected: false },
		{ value: 42, expected: false },
		{ value: null, expected: false },
		{ value: ["en"], expected: false },
	])("$value -> $expected", ({ value, expected }) => {
		expect(isSupportedLanguage(value)).toBe(expected)
	})
})
