import { describe, expect, test } from "bun:test"

import { decodeMarkdownUrl, getPageMarkdownUrl } from "./markdown"
import { isValidSlugPath } from "./slugs"

describe("getPageMarkdownUrl", () => {
	test("maps the index page and nested pages to raw Markdown paths", () => {
		expect(getPageMarkdownUrl({ slugs: [] }).url).toBe("/index.md")
		expect(getPageMarkdownUrl({ slugs: ["deployment"] }).url).toBe("/deployment.md")
		expect(getPageMarkdownUrl({ slugs: ["guides", "deployment"] }).url).toBe("/guides/deployment.md")
	})
})

describe("decodeMarkdownUrl", () => {
	test("round-trips index and page Markdown paths", () => {
		expect(decodeMarkdownUrl(["index.md"])).toEqual([])
		expect(decodeMarkdownUrl(["deployment.md"])).toEqual(["deployment"])
		expect(decodeMarkdownUrl(["guides", "deployment.md"])).toEqual(["guides", "deployment"])
	})
})

describe("isValidSlugPath", () => {
	test("rejects empty strings, too many segments, and oversized segments", () => {
		expect(isValidSlugPath([])).toBe(true)
		expect(isValidSlugPath(["deployment"])).toBe(true)
		expect(isValidSlugPath([""])).toBe(false)
		expect(isValidSlugPath(Array.from({ length: 33 }, (_, index) => `page-${index}`))).toBe(false)
		expect(isValidSlugPath(["x".repeat(257)])).toBe(false)
	})
})
