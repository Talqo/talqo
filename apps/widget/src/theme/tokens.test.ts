import { DEFAULT_WIDGET_APPEARANCE } from "@talqo/shared/widget-appearance"
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8")

function customProperty(name: string): string | undefined {
	return new RegExp(String.raw`--talqo-${name}-input:\s*(#[0-9a-fA-F]{6});`).exec(css)?.[1]
}

// These literals paint the frame before JS applies the inline values, so they have to
// stay the shared defaults. Nothing else cross-checks them.
describe("tokens.css seed colors", () => {
	test("match DEFAULT_WIDGET_APPEARANCE", () => {
		expect(customProperty("primary")).toBe(DEFAULT_WIDGET_APPEARANCE.primary)
		expect(customProperty("primary-foreground")).toBe(DEFAULT_WIDGET_APPEARANCE.primaryForeground)
		expect(customProperty("background")).toBe(DEFAULT_WIDGET_APPEARANCE.background)
		expect(customProperty("foreground")).toBe(DEFAULT_WIDGET_APPEARANCE.foreground)
	})
})
