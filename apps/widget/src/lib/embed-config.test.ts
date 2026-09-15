import { describe, expect, test } from "bun:test"

import { apiOrigin, appearanceFromDataset, appearanceFromValues, mergeAppearance } from "./embed-config"

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

test("extracts appearance from canonical getter keys", () => {
	const values: Record<string, string> = {
		accent: "#123456",
		darkText: "#ffffff",
		position: "bottom-left",
		themeToggle: "false",
	}

	expect(appearanceFromValues((key) => values[key])).toEqual({
		light: { primary: "#123456" },
		dark: { text: "#ffffff" },
		position: "bottom-left",
		themeToggle: false,
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
