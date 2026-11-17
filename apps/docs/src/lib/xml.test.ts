import { expect, test } from "bun:test"

import { escapeXml } from "./xml"

test("escapes every XML delimiter in sitemap values", () => {
	expect(escapeXml(`<tag attr="a&b">'text'</tag>`)).toBe(
		"&lt;tag attr=&quot;a&amp;b&quot;&gt;&apos;text&apos;&lt;/tag&gt;",
	)
})

test("preserves ordinary URL characters and Unicode", () => {
	expect(escapeXml("https://docs.example/部署?q=setup#install")).toBe("https://docs.example/部署?q=setup#install")
})
