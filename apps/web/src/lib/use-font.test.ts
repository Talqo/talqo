import { describe, expect, test } from "bun:test"

import { resolveFontVariant } from "./use-font"

describe("resolveFontVariant", () => {
	test("keeps a previously assigned variant", () => {
		expect(resolveFontVariant("inter", () => 0.9)).toBe("inter")
		expect(resolveFontVariant("nunito", () => 0.1)).toBe("nunito")
	})

	test("assigns uniformly at random when unassigned", () => {
		expect(resolveFontVariant(null, () => 0.49)).toBe("inter")
		expect(resolveFontVariant(null, () => 0.5)).toBe("nunito")
	})

	test("ignores invalid stored values and re-assigns", () => {
		expect(resolveFontVariant("geist", () => 0.9)).toBe("nunito")
	})
})
