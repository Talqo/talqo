import { describe, expect, test } from "bun:test"

import { decodeMarkdownUrl, getPageMarkdownUrl } from "./markdown"

describe("getPageMarkdownUrl", () => {
	test("maps the index page and nested pages to raw Markdown paths", () => {
		expect(getPageMarkdownUrl({ slugs: [] }).url).toBe("/index.md")
		expect(getPageMarkdownUrl({ slugs: ["deployment"] }).url).toBe("/deployment.md")
		expect(getPageMarkdownUrl({ slugs: ["guides", "deployment"] }).url).toBe("/guides/deployment.md")
	})

	test("prefixes the locale and leaves the caller's segments untouched", () => {
		const slugs = ["guides", "deployment"]

		expect(getPageMarkdownUrl({ slugs, locale: "cs" }).url).toBe("/cs/guides/deployment.md")
		expect(slugs).toEqual(["guides", "deployment"])
	})
})

describe("decodeMarkdownUrl", () => {
	test("round-trips index and page Markdown paths", () => {
		expect(decodeMarkdownUrl([])).toEqual([])
		expect(decodeMarkdownUrl(["index.md"])).toEqual([])
		expect(decodeMarkdownUrl(["deployment.md"])).toEqual(["deployment"])
		expect(decodeMarkdownUrl(["guides", "deployment.md"])).toEqual(["guides", "deployment"])
	})

	test("drops the extension only when it ends the segment", () => {
		expect(decodeMarkdownUrl(["notes.md.b.md"])).toEqual(["notes.md.b"])
		expect(decodeMarkdownUrl(["index.md", "extra.md"])).toEqual(["index.md", "extra"])
	})
})
