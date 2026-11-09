import { describe, expect, test } from "bun:test"

import { apiOriginOverride, buildEmbedSnippet } from "./-embed-snippet"

const SCRIPT_URL = "https://cdn.example.com/widget.js"

describe("buildEmbedSnippet", () => {
	test("carries the script source and canonical embed token attribute", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { embedToken: "tok_123" })

		expect(snippet).toContain(`src="${SCRIPT_URL}"`)
		expect(snippet).toContain('data-talqo-embed-token="tok_123"')
		expect(snippet).not.toContain("data-talqo-widget")
		expect(snippet).not.toContain("undefined")
	})

	test("loads asynchronously so the widget stays off the host critical path", () => {
		expect(buildEmbedSnippet(SCRIPT_URL, { embedToken: "tok_123" })).toStartWith("<script async")
	})

	test("renders one attribute per line so the copied code stays readable", () => {
		expect(buildEmbedSnippet(SCRIPT_URL, { embedToken: "tok_123", apiOrigin: "https://api.example.com" })).toBe(
			[
				"<script async",
				`  src="${SCRIPT_URL}"`,
				'  data-talqo-embed-token="tok_123"',
				'  data-talqo-api="https://api.example.com"',
				"></script>",
			].join("\n"),
		)
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

	test("escapes every ampersand between source URL query parameters", () => {
		const snippet = buildEmbedSnippet("https://cdn.example.com/widget.js?v=2&channel=stable&theme=dark", {
			embedToken: "tok_123",
		})

		expect(snippet).toContain('src="https://cdn.example.com/widget.js?v=2&amp;channel=stable&amp;theme=dark"')
	})
})

describe("apiOriginOverride", () => {
	test("omits the override for same-origin and absent API origins", () => {
		expect(apiOriginOverride(SCRIPT_URL, "https://cdn.example.com/api/v1")).toBeUndefined()
		expect(apiOriginOverride(SCRIPT_URL, undefined)).toBeUndefined()
	})

	test("uses the canonical origin for a split API deployment", () => {
		expect(apiOriginOverride(SCRIPT_URL, "https://api.example.com/api/v1?tenant=shop")).toBe("https://api.example.com")
	})

	test("ignores an unparseable origin rather than emitting a broken attribute", () => {
		expect(apiOriginOverride(SCRIPT_URL, "not a url")).toBeUndefined()
	})
})
