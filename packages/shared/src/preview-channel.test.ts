import { describe, expect, test } from "bun:test"

import {
	configFromMessage,
	configMessage,
	isReadyMessage,
	PREVIEW_CHANNEL_VERSION,
	readyMessage,
	trustedParentOrigin,
} from "./preview-channel"
import { DEFAULT_WIDGET_APPEARANCE } from "./widget-appearance"

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
	test("builds config messages for the current protocol with optional presentation", () => {
		expect(configMessage(DEFAULT_WIDGET_APPEARANCE)).toEqual({
			source: "talqo-preview",
			version: PREVIEW_CHANNEL_VERSION,
			type: "config",
			appearance: DEFAULT_WIDGET_APPEARANCE,
			title: undefined,
			forcedScheme: undefined,
			isAvailable: undefined,
		})
		expect(
			configMessage(DEFAULT_WIDGET_APPEARANCE, { title: "Preview", forcedScheme: "light", isAvailable: true }),
		).toEqual({
			source: "talqo-preview",
			version: PREVIEW_CHANNEL_VERSION,
			type: "config",
			appearance: DEFAULT_WIDGET_APPEARANCE,
			title: "Preview",
			forcedScheme: "light",
			isAvailable: true,
		})
	})

	test("recognizes only the current ready handshake", () => {
		expect(readyMessage()).toEqual({ source: "talqo-preview", version: PREVIEW_CHANNEL_VERSION, type: "ready" })
		expect(isReadyMessage(readyMessage())).toBe(true)
		expect(isReadyMessage({ source: "some-other-embed", version: 1, type: "ready" })).toBe(false)
		expect(isReadyMessage({ source: "talqo-preview", version: 99, type: "ready" })).toBe(false)
		expect(isReadyMessage({ source: "talqo-preview", version: 1, type: "config" })).toBe(false)
		for (const value of [undefined, null, "ready"]) expect(isReadyMessage(value)).toBe(false)
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
			isAvailable: undefined,
		})
		expect(configFromMessage(message({ title: "Marketing site", forcedScheme: "dark", isAvailable: false }))).toEqual({
			appearance: partialAppearance,
			title: "Marketing site",
			forcedScheme: "dark",
			isAvailable: false,
		})
		expect(configFromMessage(message({ forcedScheme: "sepia" }))?.forcedScheme).toBeUndefined()
		expect(configFromMessage(message({ forcedScheme: "light" }))?.forcedScheme).toBe("light")
		expect(configFromMessage(message({ title: 42 }))?.title).toBeUndefined()
		expect(configFromMessage(message({ isAvailable: "no" }))?.isAvailable).toBeUndefined()
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
