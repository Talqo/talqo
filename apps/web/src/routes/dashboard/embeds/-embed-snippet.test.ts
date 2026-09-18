import { describe, expect, test } from "bun:test"

import { apiOriginOverride, buildEmbedSnippet } from "./-embed-snippet"

const SCRIPT_URL = "https://cdn.example.com/widget.js"

describe("buildEmbedSnippet", () => {
	test("carries the script source and canonical embed token attribute", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { embedToken: "tok_123" })

		expect(snippet).toContain(`src="${SCRIPT_URL}"`)
		expect(snippet).toContain('data-talqo-embed-token="tok_123"')
		expect(snippet).not.toContain("data-talqo-widget")
	})

	test("omits the API origin when it is not supplied", () => {
		expect(buildEmbedSnippet(SCRIPT_URL, { embedToken: "tok_123" })).not.toContain("data-talqo-api")
	})

	test("includes the API origin when the deployment needs one", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { embedToken: "tok_123", apiOrigin: "https://api.example.com" })

		expect(snippet).toContain('data-talqo-api="https://api.example.com"')
	})

	test("escapes attribute-breaking characters in the token", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { embedToken: 'tok"><script>' })

		expect(snippet).not.toContain('tok"><script>')
		expect(snippet).toContain("&quot;&gt;&lt;script&gt;")
	})
})

describe("apiOriginOverride", () => {
	test("is undefined when the API shares the script origin", () => {
		expect(apiOriginOverride(SCRIPT_URL, "https://cdn.example.com")).toBeUndefined()
	})

	test("is undefined when no API origin is configured", () => {
		expect(apiOriginOverride(SCRIPT_URL, undefined)).toBeUndefined()
	})

	test("returns the origin when the API lives elsewhere", () => {
		expect(apiOriginOverride(SCRIPT_URL, "https://api.example.com/base")).toBe("https://api.example.com")
	})

	test("ignores an unparseable origin rather than emitting a broken attribute", () => {
		expect(apiOriginOverride(SCRIPT_URL, "not a url")).toBeUndefined()
	})
})
