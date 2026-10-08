import { describe, expect, it } from "bun:test"

import { parseDaysParam } from "./ranges.ts"

describe("parseDaysParam", () => {
	it("treats a missing parameter as the default range", () => {
		expect(parseDaysParam(undefined)).toBeUndefined()
	})

	it("accepts every preset", () => {
		expect(parseDaysParam(7)).toBe(7)
		expect(parseDaysParam(30)).toBe(30)
		expect(parseDaysParam(183)).toBe(183)
		expect(parseDaysParam(365)).toBe(365)
		expect(parseDaysParam("all")).toBe("all")
	})

	it("rejects values outside the presets", () => {
		expect(parseDaysParam(14)).toBeUndefined()
		expect(parseDaysParam("7")).toBeUndefined()
		expect(parseDaysParam("monthly")).toBeUndefined()
		expect(parseDaysParam(null)).toBeUndefined()
	})
})
