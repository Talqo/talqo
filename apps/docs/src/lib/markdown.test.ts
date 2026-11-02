import { describe, expect, test } from "bun:test"

import { decodeMarkdownUrl, getPageMarkdownUrl } from "./markdown"

describe("getPageMarkdownUrl", () => {
	test("maps the index page and nested pages to raw Markdown paths", () => {
		expect(getPageMarkdownUrl({ slugs: [] }).url).toBe("/index.md")
		expect(getPageMarkdownUrl({ slugs: ["deployment"] }).url).toBe("/deployment.md")
	})
})

describe("decodeMarkdownUrl", () => {
	test("round-trips index and page Markdown paths", () => {
		expect(decodeMarkdownUrl(["index.md"])).toEqual([])
		expect(decodeMarkdownUrl(["deployment.md"])).toEqual(["deployment"])
		expect(decodeMarkdownUrl(["guides", "deployment.md"])).toEqual(["guides", "deployment"])
	})
})
