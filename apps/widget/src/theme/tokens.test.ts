import { DEFAULT_DARK_SCHEME, DEFAULT_LIGHT_SCHEME } from "@talqo/shared/widget-appearance"
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8")

function customProperty(name: string): string | undefined {
	return new RegExp(String.raw`--talqo-${name}-input:\s*(#[0-9a-fA-F]{6});`).exec(css)?.[1]
}

function baseDestructiveToken(): string | undefined {
	const block = /\.talqo-widget\s*\{([\s\S]*?)\}/.exec(css)?.[1]
	return block ? /--talqo-destructive:\s*(#[0-9a-fA-F]{6});/.exec(block)?.[1] : undefined
}

function channels(hex: string): [number, number, number] {
	const [red = 0, green = 0, blue = 0] =
		hex
			.slice(1)
			.match(/../g)
			?.map((channel) => Number.parseInt(channel, 16)) ?? []
	return [red, green, blue]
}

function linear(channel: number): number {
	const value = channel / 255
	return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
	const [red, green, blue] = channels(hex)
	return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

function contrast(foreground: string, background: string): number {
	const light = Math.max(luminance(foreground), luminance(background))
	const dark = Math.min(luminance(foreground), luminance(background))
	return (light + 0.05) / (dark + 0.05)
}

function tint(hex: string, background: string, amount: number): string {
	const [red, green, blue] = channels(hex)
	const [backdropRed, backdropGreen, backdropBlue] = channels(background)
	const mix = (foreground: number, behind: number) => Math.round(foreground * amount + behind * (1 - amount))
	return `#${[mix(red, backdropRed), mix(green, backdropGreen), mix(blue, backdropBlue)]
		.map((channel) => channel.toString(16).padStart(2, "0"))
		.join("")}`
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

describe("accessible widget colors", () => {
	test("destructive text reaches 4.5:1 on plain and tinted light backgrounds", () => {
		const destructive = baseDestructiveToken()
		if (!destructive) throw new Error("destructive token missing")
		expect(contrast(destructive, DEFAULT_LIGHT_SCHEME.background)).toBeGreaterThanOrEqual(4.5)
		expect(contrast(destructive, tint(destructive, DEFAULT_LIGHT_SCHEME.background, 0.1))).toBeGreaterThanOrEqual(4.5)
	})

	test("destructive text reaches 4.5:1 on plain and tinted dark backgrounds", () => {
		const darkDestructive =
			/\.talqo-widget\[data-scheme="dark"\]\s*\{[^}]*--talqo-destructive:\s*(#[0-9a-fA-F]{6});/.exec(css)?.[1]
		if (!darkDestructive) throw new Error("dark destructive token missing")
		expect(contrast(darkDestructive, DEFAULT_DARK_SCHEME.background)).toBeGreaterThanOrEqual(4.5)
		expect(
			contrast(darkDestructive, tint(darkDestructive, DEFAULT_DARK_SCHEME.background, 0.1)),
		).toBeGreaterThanOrEqual(4.5)
	})

	test("input border reaches 3:1 against the light and dark input surfaces", () => {
		const match = /--talqo-input-border:\s*color-mix\(in srgb, var\(--talqo-text-input\) (\d+)%, transparent\)/.exec(
			css,
		)
		const amount = match?.[1] ? Number(match[1]) / 100 : undefined
		if (amount === undefined) throw new Error("input border token missing")

		// The text scrim composites over the input surface.
		for (const scheme of [DEFAULT_LIGHT_SCHEME, DEFAULT_DARK_SCHEME]) {
			const mixed = tint(scheme.text, scheme.surface, amount)
			expect(contrast(mixed, scheme.surface)).toBeGreaterThanOrEqual(3)
		}
	})
})
