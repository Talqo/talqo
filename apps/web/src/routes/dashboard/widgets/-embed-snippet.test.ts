import { describe, expect, test } from "bun:test"

import { apiOriginOverride, buildEmbedSnippet } from "./-embed-snippet"

const SCRIPT_URL = "https://cdn.example.com/widget.js"

describe("buildEmbedSnippet", () => {
	test("carries the script source and the public token", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { publicToken: "tok_123" })

		expect(snippet).toContain(`src="${SCRIPT_URL}"`)
		expect(snippet).toContain('data-talqo-widget="tok_123"')
	})

	test("omits the API origin when it is not supplied", () => {
		expect(buildEmbedSnippet(SCRIPT_URL, { publicToken: "tok_123" })).not.toContain("data-talqo-api")
	})

	test("includes the API origin when the deployment needs one", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { publicToken: "tok_123", apiOrigin: "https://api.example.com" })

		expect(snippet).toContain('data-talqo-api="https://api.example.com"')
	})

	// The whole point of fetching by token: a copied snippet must not freeze the palette.
	test("never emits appearance attributes", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { publicToken: "tok_123", apiOrigin: "https://api.example.com" })

		for (const attribute of [
			"data-talqo-accent",
			"data-talqo-primary",
			"data-talqo-background",
			"data-talqo-foreground",
			"data-talqo-position",
			"data-talqo-language",
			"data-talqo-theme",
		]) {
			expect(snippet).not.toContain(attribute)
		}
	})

	test("escapes attribute-breaking characters in the token", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { publicToken: 'tok"><script>' })

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
