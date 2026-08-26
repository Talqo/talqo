import { describe, expect, test } from "bun:test"

import { apiOrigin, appearanceFromDataset, configUrl, parseWidgetConfig, WIDGET_CONFIG_VERSION } from "./embed-config"

// Registers happy-dom; the script-element helpers below need a document.
await import("@/test-setup")

describe("appearanceFromDataset", () => {
	test("returns no overrides for a missing script", () => {
		expect(appearanceFromDataset(undefined)).toEqual({})
	})

	test("omits absent attributes rather than defaulting them", () => {
		expect(appearanceFromDataset({ talqoAgent: "agent-1" })).toEqual({})
	})

	test("maps the four palette attributes", () => {
		expect(
			appearanceFromDataset({
				talqoPrimary: "#1a7f4b",
				talqoPrimaryForeground: "#ffffff",
				talqoBackground: "#0a0a0a",
				talqoForeground: "#fafafa",
			}),
		).toEqual({
			primary: "#1a7f4b",
			primaryForeground: "#ffffff",
			background: "#0a0a0a",
			foreground: "#fafafa",
		})
	})

	test("accepts the legacy accent attribute as primary", () => {
		expect(appearanceFromDataset({ talqoAccent: "#123456" })).toEqual({ primary: "#123456" })
	})

	test("prefers the canonical primary attribute over the legacy alias", () => {
		expect(appearanceFromDataset({ talqoPrimary: "#111111", talqoAccent: "#222222" })).toEqual({ primary: "#111111" })
	})

	test("parses the theme toggle as a boolean and ignores other values", () => {
		expect(appearanceFromDataset({ talqoThemeToggle: "true" })).toEqual({ themeToggle: true })
		expect(appearanceFromDataset({ talqoThemeToggle: "false" })).toEqual({ themeToggle: false })
		expect(appearanceFromDataset({ talqoThemeToggle: "yes" })).toEqual({})
	})

	test("passes enum-like values through unvalidated for resolveAppearance to judge", () => {
		expect(appearanceFromDataset({ talqoPosition: "top-left", talqoTheme: "neon", talqoLanguage: "xx" })).toEqual({
			position: "top-left",
			theme: "neon",
			language: "xx",
		})
	})
})

function script(attributes: Record<string, string>): HTMLScriptElement {
	const element = document.createElement("script")
	for (const [name, value] of Object.entries(attributes)) {
		element.setAttribute(name, value)
	}
	return element
}

describe("apiOrigin", () => {
	test("defaults to the origin the widget script itself came from", () => {
		expect(apiOrigin(script({ src: "https://cdn.example.com/widget.js" }))).toBe("https://cdn.example.com")
	})

	test("prefers an explicit data-talqo-api for split deployments", () => {
		const element = script({ src: "https://cdn.example.com/widget.js", "data-talqo-api": "https://api.example.com" })

		expect(apiOrigin(element)).toBe("https://api.example.com")
	})

	test("falls back to the script origin when the override is unparseable", () => {
		const element = script({ src: "https://cdn.example.com/widget.js", "data-talqo-api": "nonsense" })

		expect(apiOrigin(element)).toBe("https://cdn.example.com")
	})

	test("is undefined without a script, so no fetch is attempted", () => {
		expect(apiOrigin(null)).toBeUndefined()
	})
})

describe("configUrl", () => {
	test("targets the public config path", () => {
		expect(configUrl("https://api.example.com", "tok_123")).toBe("https://api.example.com/api/widget-config/tok_123")
	})

	test("encodes a token containing URL-significant characters", () => {
		expect(configUrl("https://api.example.com", "a/b?c")).toBe("https://api.example.com/api/widget-config/a%2Fb%3Fc")
	})
})

describe("parseWidgetConfig", () => {
	const appearance = { primary: "#123456", position: "bottom-left" }

	test("extracts the appearance and agent from a current payload", () => {
		const result = parseWidgetConfig({ version: WIDGET_CONFIG_VERSION, agentId: "agent-1", appearance })

		expect(result.agentId).toBe("agent-1")
		expect(result.appearance).toEqual(appearance)
	})

	// Degrade, never throw: a widget on a customer page must survive a bad response.
	test("yields no overrides for a future or missing version", () => {
		expect(parseWidgetConfig({ version: 99, appearance }).appearance).toEqual({})
		expect(parseWidgetConfig({ appearance }).appearance).toEqual({})
	})

	test("yields no overrides when the appearance is missing or not an object", () => {
		expect(parseWidgetConfig({ version: WIDGET_CONFIG_VERSION }).appearance).toEqual({})
		expect(parseWidgetConfig({ version: WIDGET_CONFIG_VERSION, appearance: "green" }).appearance).toEqual({})
		expect(parseWidgetConfig({ version: WIDGET_CONFIG_VERSION, appearance: [] }).appearance).toEqual({})
	})

	test("yields no overrides for a non-object payload", () => {
		expect(parseWidgetConfig(undefined).appearance).toEqual({})
		expect(parseWidgetConfig(null).appearance).toEqual({})
		expect(parseWidgetConfig("nope").appearance).toEqual({})
	})

	test("ignores a non-string agent id", () => {
		expect(parseWidgetConfig({ version: WIDGET_CONFIG_VERSION, agentId: 7, appearance }).agentId).toBeUndefined()
	})
})
