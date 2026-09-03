import { DEFAULT_LIGHT_SCHEME } from "@talqo/shared/widget-appearance"
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8")

function customProperty(name: string): string | undefined {
	return new RegExp(String.raw`--talqo-${name}-input:\s*(#[0-9a-fA-F]{6});`).exec(css)?.[1]
}

// These literals paint before JS applies the inline values, and nothing else checks them.
describe("tokens.css seed colors", () => {
	test("match DEFAULT_LIGHT_SCHEME", () => {
		expect(customProperty("primary")).toBe(DEFAULT_LIGHT_SCHEME.primary)
		expect(customProperty("text-on-primary")).toBe(DEFAULT_LIGHT_SCHEME.textOnPrimary)
		expect(customProperty("background")).toBe(DEFAULT_LIGHT_SCHEME.background)
		expect(customProperty("surface")).toBe(DEFAULT_LIGHT_SCHEME.surface)
		expect(customProperty("text")).toBe(DEFAULT_LIGHT_SCHEME.text)
	})
})
