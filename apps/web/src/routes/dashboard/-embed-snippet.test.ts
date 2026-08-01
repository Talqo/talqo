import { describe, expect, test } from "bun:test"

import { buildEmbedSnippet } from "./-embed-snippet"

const SCRIPT_URL = "https://widgets.example.com/widget.js"

describe("buildEmbedSnippet", () => {
	test("emits script origin and bot id", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { botId: "bot-1" })
		expect(snippet).toContain(`src="${SCRIPT_URL}"`)
		expect(snippet).toContain('data-talqo-bot="bot-1"')
		expect(snippet.startsWith("<script")).toBe(true)
		expect(snippet.endsWith("></script>")).toBe(true)
	})

	test("wires valid appearance settings into data attributes", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, {
			botId: "bot-1",
			accent: "#1a7f4b",
			language: "cs",
			position: "bottom-left",
		})
		expect(snippet).toContain('data-talqo-accent="#1a7f4b"')
		expect(snippet).toContain('data-talqo-language="cs"')
		expect(snippet).toContain('data-talqo-position="bottom-left"')
	})

	test("omits accent values that are not hex colors", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { botId: "bot-1", accent: "green" })
		expect(snippet).not.toContain("data-talqo-accent")
	})

	test("escapes attribute values", () => {
		const snippet = buildEmbedSnippet(SCRIPT_URL, { botId: 'bot" onload="alert(1)' })
		expect(snippet).toContain('data-talqo-bot="bot&quot; onload=&quot;alert(1)"')
	})
})
