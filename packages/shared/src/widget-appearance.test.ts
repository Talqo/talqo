import { describe, expect, test } from "bun:test"

import {
	CONTRAST_AA_NORMAL,
	contrastRatio,
	DEFAULT_DARK_SCHEME,
	DEFAULT_LIGHT_SCHEME,
	isHexColor,
	isWidgetPosition,
	isWidgetTheme,
	relativeLuminance,
} from "./widget-appearance"

describe("isHexColor", () => {
	test("accepts six-digit hex in either case", () => {
		expect(isHexColor("#1a7f4b")).toBe(true)
		expect(isHexColor("#1A7F4B")).toBe(true)
	})

	test("rejects shorthand, functional notation, and non-strings", () => {
		expect(isHexColor("#abc")).toBe(false)
		expect(isHexColor("#gggggg")).toBe(false)
		expect(isHexColor("rgb(0, 0, 0)")).toBe(false)
		expect(isHexColor("1a7f4b")).toBe(false)
		expect(isHexColor(undefined)).toBe(false)
		expect(isHexColor(0x1a7f4b)).toBe(false)
	})
})

describe("relativeLuminance", () => {
	test("matches the WCAG reference values at both extremes", () => {
		expect(relativeLuminance("#000000")).toBeCloseTo(0)
		expect(relativeLuminance("#ffffff")).toBeCloseTo(1)
	})

	test("weights green above red above blue", () => {
		expect(relativeLuminance("#00ff00")).toBeGreaterThan(relativeLuminance("#ff0000"))
		expect(relativeLuminance("#ff0000")).toBeGreaterThan(relativeLuminance("#0000ff"))
	})
})

describe("contrastRatio", () => {
	test("black on white is the maximum 21:1", () => {
		expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21)
	})

	test("is symmetric and bottoms out at 1 for identical colors", () => {
		expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21)
		expect(contrastRatio("#1a7f4b", "#1a7f4b")).toBeCloseTo(1)
	})

	test("both default schemes pair clear AA for normal text", () => {
		expect(contrastRatio(DEFAULT_LIGHT_SCHEME.background, DEFAULT_LIGHT_SCHEME.text)).toBeGreaterThan(
			CONTRAST_AA_NORMAL,
		)
		expect(contrastRatio(DEFAULT_LIGHT_SCHEME.primary, DEFAULT_LIGHT_SCHEME.textOnPrimary)).toBeGreaterThan(
			CONTRAST_AA_NORMAL,
		)
		expect(contrastRatio(DEFAULT_DARK_SCHEME.background, DEFAULT_DARK_SCHEME.text)).toBeGreaterThan(CONTRAST_AA_NORMAL)
		expect(contrastRatio(DEFAULT_DARK_SCHEME.primary, DEFAULT_DARK_SCHEME.textOnPrimary)).toBeGreaterThan(
			CONTRAST_AA_NORMAL,
		)
	})

	test("dark is a distinct palette, not a derivation of light", () => {
		expect(DEFAULT_DARK_SCHEME.primary).not.toBe(DEFAULT_LIGHT_SCHEME.primary)
		expect(DEFAULT_DARK_SCHEME.background).not.toBe(DEFAULT_LIGHT_SCHEME.background)
	})
})

describe("value guards", () => {
	test("isWidgetPosition accepts only the two supported placements", () => {
		expect(isWidgetPosition("bottom-right")).toBe(true)
		expect(isWidgetPosition("bottom-left")).toBe(true)
		expect(isWidgetPosition("top-right")).toBe(false)
		expect(isWidgetPosition(undefined)).toBe(false)
	})

	test("isWidgetTheme accepts system, light, and dark", () => {
		expect(isWidgetTheme("system")).toBe(true)
		expect(isWidgetTheme("light")).toBe(true)
		expect(isWidgetTheme("dark")).toBe(true)
		expect(isWidgetTheme("auto")).toBe(false)
	})
})
