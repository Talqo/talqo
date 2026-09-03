import { WIDGET_CONFIG_VERSION } from "@talqo/shared/widget-appearance"
import { describe, expect, test } from "bun:test"

import { apiOrigin, appearanceFromDataset, configUrl, mergeAppearance, parseWidgetConfig } from "./embed-config"

// Registers happy-dom: the script-element helpers need a document.
await import("@/test-setup")

describe("appearanceFromDataset", () => {
	test("returns no overrides for a missing script", () => {
		expect(appearanceFromDataset(undefined)).toEqual({})
	})

	test("omits absent attributes rather than defaulting them", () => {
		expect(appearanceFromDataset({ talqoAgent: "agent-1" })).toEqual({})
	})

	test("maps the five light-scheme attributes", () => {
		expect(
			appearanceFromDataset({
				talqoLightPrimary: "#1a7f4b",
				talqoLightTextOnPrimary: "#ffffff",
				talqoLightBackground: "#f0f0f0",
				talqoLightSurface: "#e0e0e0",
				talqoLightText: "#101010",
			}),
		).toEqual({
			light: {
				primary: "#1a7f4b",
				textOnPrimary: "#ffffff",
				background: "#f0f0f0",
				surface: "#e0e0e0",
				text: "#101010",
			},
		})
	})

	test("maps the five dark-scheme attributes separately from light", () => {
		expect(
			appearanceFromDataset({
				talqoDarkPrimary: "#34d399",
				talqoDarkBackground: "#0a0a0a",
			}),
		).toEqual({ dark: { primary: "#34d399", background: "#0a0a0a" } })
	})

	test("accepts the legacy accent attribute as the light primary", () => {
		expect(appearanceFromDataset({ talqoAccent: "#123456" })).toEqual({ light: { primary: "#123456" } })
	})

	test("prefers the canonical light primary attribute over the legacy alias", () => {
		expect(appearanceFromDataset({ talqoLightPrimary: "#111111", talqoAccent: "#222222" })).toEqual({
			light: { primary: "#111111" },
		})
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

describe("mergeAppearance", () => {
	const stored = {
		light: { primary: "#1a7f4b", background: "#ffffff", text: "#171717" },
		dark: { primary: "#34d399", background: "#0a0a0a" },
		position: "bottom-right",
	}

	test("patches one color without dropping the rest of the stored scheme", () => {
		expect(mergeAppearance(stored, { light: { primary: "#123456" } })).toEqual({
			light: { primary: "#123456", background: "#ffffff", text: "#171717" },
			dark: { primary: "#34d399", background: "#0a0a0a" },
			position: "bottom-right",
		})
	})

	test("overrides top-level values and leaves untouched schemes alone", () => {
		expect(mergeAppearance(stored, { position: "bottom-left" })).toEqual({ ...stored, position: "bottom-left" })
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
	const appearance = { light: { primary: "#123456" }, position: "bottom-left" }

	test("extracts the appearance, agent, and name from a current payload", () => {
		const result = parseWidgetConfig({
			version: WIDGET_CONFIG_VERSION,
			agentId: "agent-1",
			name: "Marketing site",
			appearance,
		})

		expect(result.agentId).toBe("agent-1")
		expect(result.name).toBe("Marketing site")
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

	test("ignores a non-string agent id and name", () => {
		const result = parseWidgetConfig({ version: WIDGET_CONFIG_VERSION, agentId: 7, name: 7, appearance })
		expect(result.agentId).toBeUndefined()
		expect(result.name).toBeUndefined()
	})
})
