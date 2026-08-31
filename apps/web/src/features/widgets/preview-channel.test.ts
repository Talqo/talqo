import { describe, expect, test } from "bun:test"

import { configMessage, isReadyMessage, PREVIEW_CHANNEL_VERSION } from "./preview-channel"

const appearance = {
	light: { primary: "#1a7f4b", textOnPrimary: "#ffffff", background: "#ffffff", surface: "#f5f5f5", text: "#171717" },
	dark: { primary: "#34d399", textOnPrimary: "#052e16", background: "#0a0a0a", surface: "#1a1a1a", text: "#fafafa" },
	position: "bottom-right",
	theme: "system",
	themeToggle: true,
	language: "en",
} as const

describe("configMessage", () => {
	test("stamps the source and version so the child can reject strangers", () => {
		const message = configMessage(appearance)

		expect(message.source).toBe("talqo-preview")
		expect(message.version).toBe(PREVIEW_CHANNEL_VERSION)
		expect(message.type).toBe("config")
		expect(message.appearance).toEqual(appearance)
		expect(message.title).toBeUndefined()
		expect(message.forcedScheme).toBeUndefined()
	})

	test("carries the title and forced scheme when given", () => {
		const message = configMessage(appearance, { title: "Marketing site", forcedScheme: "dark" })

		expect(message.title).toBe("Marketing site")
		expect(message.forcedScheme).toBe("dark")
	})
})

describe("isReadyMessage", () => {
	test("accepts a well-formed ready handshake", () => {
		expect(isReadyMessage({ source: "talqo-preview", version: PREVIEW_CHANNEL_VERSION, type: "ready" })).toBe(true)
	})

	test("rejects another sender's message on the same window", () => {
		expect(isReadyMessage({ source: "some-other-embed", version: PREVIEW_CHANNEL_VERSION, type: "ready" })).toBe(false)
	})

	test("rejects a mismatched version instead of throwing", () => {
		expect(isReadyMessage({ source: "talqo-preview", version: 99, type: "ready" })).toBe(false)
	})

	test("rejects the wrong message type", () => {
		expect(isReadyMessage({ source: "talqo-preview", version: PREVIEW_CHANNEL_VERSION, type: "config" })).toBe(false)
	})

	test("rejects non-object payloads", () => {
		expect(isReadyMessage(undefined)).toBe(false)
		expect(isReadyMessage(null)).toBe(false)
		expect(isReadyMessage("ready")).toBe(false)
	})
})
