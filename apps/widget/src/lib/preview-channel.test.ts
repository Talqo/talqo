import { describe, expect, test } from "bun:test"

import { configFromMessage, PREVIEW_CHANNEL_VERSION, readyMessage, trustedParentOrigin } from "./preview-channel"

const appearance = { primary: "#1a7f4b", position: "bottom-left" }

function message(overrides: Record<string, unknown> = {}) {
	return { source: "talqo-preview", version: PREVIEW_CHANNEL_VERSION, type: "config", appearance, ...overrides }
}

describe("readyMessage", () => {
	test("identifies itself so the dashboard can filter other senders", () => {
		expect(readyMessage()).toEqual({ source: "talqo-preview", version: PREVIEW_CHANNEL_VERSION, type: "ready" })
	})
})

describe("trustedParentOrigin", () => {
	test("accepts the origin the dashboard sends", () => {
		expect(trustedParentOrigin("https://dashboard.example.com")).toBe("https://dashboard.example.com")
		expect(trustedParentOrigin("http://localhost:5173")).toBe("http://localhost:5173")
	})

	// A wildcard would post the handshake to whatever framed the preview.
	test("rejects a wildcard, a path, and anything that is not a URL", () => {
		expect(trustedParentOrigin("*")).toBeUndefined()
		expect(trustedParentOrigin("https://dashboard.example.com/preview")).toBeUndefined()
		expect(trustedParentOrigin("dashboard.example.com")).toBeUndefined()
	})

	test("treats an absent parameter as no parent", () => {
		expect(trustedParentOrigin(null)).toBeUndefined()
		expect(trustedParentOrigin("")).toBeUndefined()
	})
})

describe("configFromMessage", () => {
	test("extracts the appearance from a well-formed message", () => {
		expect(configFromMessage(message())).toEqual(appearance)
	})

	test("ignores another embed's traffic on the same window", () => {
		expect(configFromMessage(message({ source: "other-embed" }))).toBeUndefined()
	})

	// A cached preview.html from an older deploy must degrade, not throw.
	test("ignores a mismatched channel version", () => {
		expect(configFromMessage(message({ version: 99 }))).toBeUndefined()
	})

	test("ignores the handshake message itself", () => {
		expect(configFromMessage(message({ type: "ready" }))).toBeUndefined()
	})

	test("ignores a message with no appearance payload", () => {
		expect(configFromMessage(message({ appearance: undefined }))).toBeUndefined()
		expect(configFromMessage(message({ appearance: null }))).toBeUndefined()
		expect(configFromMessage(message({ appearance: "green" }))).toBeUndefined()
		expect(configFromMessage(message({ appearance: [] }))).toBeUndefined()
	})

	test("ignores non-object payloads", () => {
		expect(configFromMessage(undefined)).toBeUndefined()
		expect(configFromMessage(null)).toBeUndefined()
		expect(configFromMessage("config")).toBeUndefined()
	})
})
