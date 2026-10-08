import { describe, expect, it } from "bun:test"

import { parseAgentsParam } from "./agents-search.ts"

describe("parseAgentsParam", () => {
	it("treats a missing parameter as every agent", () => {
		expect(parseAgentsParam(undefined)).toBeUndefined()
	})

	it("accepts a single bare id", () => {
		expect(parseAgentsParam("a")).toEqual(["a"])
	})

	it("accepts an id list", () => {
		expect(parseAgentsParam(["a", "b"])).toEqual(["a", "b"])
	})

	it("dedupes repeated ids", () => {
		expect(parseAgentsParam(["a", "a", "b"])).toEqual(["a", "b"])
	})

	it("keeps an explicit empty selection", () => {
		expect(parseAgentsParam([])).toEqual([])
	})

	it("drops non-string entries and empty ids", () => {
		expect(parseAgentsParam(["a", 1, "", { id: "b" }])).toEqual(["a"])
	})
})
