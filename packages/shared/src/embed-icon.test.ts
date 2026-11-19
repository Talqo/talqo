import { describe, expect, test } from "bun:test"

import { isIconUrl, isSvgDocument, svgDataUrl } from "./embed-icon"

describe("isSvgDocument", () => {
	test.each([
		["a bare root", '<svg viewBox="0 0 1 1"></svg>'],
		["an XML declaration and comment", '<?xml version="1.0"?>\n<!-- logo -->\n<svg>\n</svg>\n'],
		["a byte-order mark", "﻿<svg></svg>"],
		["a root with attributes on new lines", '<svg\n  xmlns="http://www.w3.org/2000/svg"></svg>'],
	])("accepts %s", (_label, markup) => {
		expect(isSvgDocument(markup)).toBe(true)
	})

	test.each([
		["empty input", ""],
		["HTML wrapping an SVG", "<html><svg></svg></html>"],
		["a lookalike root", "<svgfoo></svgfoo>"],
		["an unclosed root", "<svg>"],
		["trailing content", "<svg></svg><script>alert(1)</script>"],
		["a DOCTYPE", '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg></svg>'],
		["an entity declaration", '<svg><!ENTITY x "x"></svg>'],
	])("rejects %s", (_label, markup) => {
		expect(isSvgDocument(markup)).toBe(false)
	})
})

describe("isIconUrl", () => {
	test("accepts absolute HTTP(S) URLs and SVG data URLs only", () => {
		expect(isIconUrl("https://api.example.test/api/embed-config/t/icon?v=1")).toBe(true)
		expect(isIconUrl("http://localhost:3000/api/embed-config/t/icon")).toBe(true)
		expect(isIconUrl(svgDataUrl('<svg viewBox="0 0 1 1"></svg>'))).toBe(true)
		for (const value of [
			"/api/embed-config/t/icon",
			"javascript:alert(1)",
			"data:text/html,<svg/>",
			"data:image/svg+xml;base64,PHN2Zy8+",
			"",
			1,
			null,
		]) {
			expect(isIconUrl(value)).toBe(false)
		}
	})
})
