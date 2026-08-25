import { describe, expect, test } from "bun:test"

import { buildEmbedSnippet } from "./-embed-snippet"

const SCRIPT_URL = "https://widgets.example.com/widget.js"

describe("buildEmbedSnippet", () => {
	test("emits script origin and embed token", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { embedToken: "token-1" })
		expect(snippet).toContain(`src="${SCRIPT_URL}"`)
		expect(snippet).toContain('data-talqo-embed-token="token-1"')
		expect(snippet).not.toContain("data-talqo-agent")
		expect(snippet.startsWith("<script")).toBe(true)
		expect(snippet.endsWith("></script>")).toBe(true)
	})

	test("wires valid appearance settings into data attributes", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, {
			embedToken: "token-1",
			accent: "#1a7f4b",
			language: "cs",
			position: "bottom-left",
		})
		expect(snippet).toContain('data-talqo-accent="#1a7f4b"')
		expect(snippet).toContain('data-talqo-language="cs"')
		expect(snippet).toContain('data-talqo-position="bottom-left"')
	})

	test("omits accent values that are not hex colors", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { embedToken: "token-1", accent: "green" })
		expect(snippet).not.toContain("data-talqo-accent")
	})

	test("escapes attribute values", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { embedToken: 'token" onload="alert(1)' })
		expect(snippet).toContain('data-talqo-embed-token="token&quot; onload=&quot;alert(1)"')
	})
})
