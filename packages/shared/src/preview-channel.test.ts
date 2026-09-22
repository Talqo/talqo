import { describe, expect, test } from "bun:test"

import {
	configFromMessage,
	configMessage,
	isReadyMessage,
	PREVIEW_CHANNEL_VERSION,
	readyMessage,
	trustedParentOrigin,
} from "./preview-channel"

const completeAppearance = {
	light: { primary: "#1a7f4b", textOnPrimary: "#ffffff", background: "#ffffff", surface: "#f5f5f5", text: "#171717" },
	dark: { primary: "#34d399", textOnPrimary: "#052e16", background: "#0a0a0a", surface: "#1a1a1a", text: "#fafafa" },
	position: "bottom-right",
	theme: "system",
	themeToggle: true,
	language: "en",
} as const
const partialAppearance = { light: { primary: "#1a7f4b" }, position: "bottom-left" }

function message(overrides: Record<string, unknown> = {}) {
	return {
		source: "talqo-preview",
		version: PREVIEW_CHANNEL_VERSION,
		type: "config",
		appearance: partialAppearance,
		...overrides,
	}
}

describe("preview channel", () => {
	test("constructs config messages with protocol identity and optional presentation", () => {
		expect(configMessage(completeAppearance)).toEqual({
			source: "talqo-preview",
			version: PREVIEW_CHANNEL_VERSION,
			type: "config",
			appearance: completeAppearance,
			title: undefined,
			forcedScheme: undefined,
		})
		expect(configMessage(completeAppearance, { title: "Marketing site", forcedScheme: "dark" })).toMatchObject({
			title: "Marketing site",
			forcedScheme: "dark",
		})
	})

	test("recognizes only the current ready handshake", () => {
		expect(isReadyMessage(readyMessage())).toBe(true)
		expect(isReadyMessage({ source: "some-other-embed", version: 1, type: "ready" })).toBe(false)
		expect(isReadyMessage({ source: "talqo-preview", version: 99, type: "ready" })).toBe(false)
		expect(isReadyMessage({ source: "talqo-preview", version: 1, type: "config" })).toBe(false)
		for (const value of [undefined, null, "ready"]) expect(isReadyMessage(value)).toBe(false)
	})

	test("constructs an identified ready handshake", () => {
		expect(readyMessage()).toEqual({ source: "talqo-preview", version: PREVIEW_CHANNEL_VERSION, type: "ready" })
	})

	test("accepts only concrete parent origins", () => {
		expect(trustedParentOrigin("https://dashboard.example.com")).toBe("https://dashboard.example.com")
		expect(trustedParentOrigin("http://localhost:5173")).toBe("http://localhost:5173")
		for (const value of ["*", "https://dashboard.example.com/preview", "dashboard.example.com", null, ""]) {
			expect(trustedParentOrigin(value)).toBeUndefined()
		}
	})

	test("extracts valid config while normalizing optional presentation", () => {
		expect(configFromMessage(message())).toEqual({
			appearance: partialAppearance,
			title: undefined,
			forcedScheme: undefined,
		})
		expect(configFromMessage(message({ title: "Marketing site", forcedScheme: "dark" }))).toEqual({
			appearance: partialAppearance,
			title: "Marketing site",
			forcedScheme: "dark",
		})
		expect(configFromMessage(message({ forcedScheme: "sepia" }))?.forcedScheme).toBeUndefined()
	})

	test("rejects foreign, stale, and malformed config messages", () => {
		expect(configFromMessage(message({ source: "other-embed" }))).toBeUndefined()
		expect(configFromMessage(message({ version: 99 }))).toBeUndefined()
		expect(configFromMessage(message({ type: "ready" }))).toBeUndefined()
		for (const appearance of [undefined, null, "green", []]) {
			expect(configFromMessage(message({ appearance }))).toBeUndefined()
		}
		for (const value of [undefined, null, "config"]) expect(configFromMessage(value)).toBeUndefined()
	})
})
