import { describe, expect, it } from "bun:test"

import { createBlacklistFilter } from "./blacklist.ts"

describe("streaming blacklist", () => {
	it("passes chunks through immediately when no terms are configured", () => {
		const filter = createBlacklistFilter([])

		expect(filter.push("tiny")).toEqual({ text: "tiny", blocked: false })
		expect(filter.finish()).toBe("")
	})

	it("blocks literal matches case-insensitively across chunks", () => {
		const filter = createBlacklistFilter(["Forbidden"])
		expect(filter.push("safe for")).toEqual({ text: "", blocked: false })
		expect(filter.push("BIDden rest")).toEqual({ text: "", blocked: true })
	})

	it("detects canonically equivalent Unicode across chunk boundaries", () => {
		const filter = createBlacklistFilter(["caf\u00e9"])
		filter.push("A caf")
		expect(filter.push("e\u0301 response").blocked).toBe(true)
	})

	it("retains a complete possible match when normalized text expands", () => {
		const filter = createBlacklistFilter(["é".repeat(20)])
		const decomposed = "e\u0301".repeat(20)

		expect(filter.push(decomposed.slice(0, 30))).toEqual({ text: "", blocked: false })
		expect(filter.push(decomposed.slice(30))).toEqual({ text: "", blocked: true })
	})

	it("emits all safe buffered output when finished", () => {
		const filter = createBlacklistFilter(["blocked"])
		const emitted = filter.push("safe text")
		expect(emitted.blocked).toBe(false)
		expect(emitted.text + filter.finish()).toBe("safe text")
	})

	it("ignores empty configured terms", () => {
		const filter = createBlacklistFilter(["", "blocked"])

		expect(filter.push("safe")).toEqual({ blocked: false, text: "" })
		expect(filter.finish()).toBe("safe")
	})

	it("stays blocked once a match was emitted", () => {
		const filter = createBlacklistFilter(["bad"])

		expect(filter.push("bad")).toEqual({ blocked: true, text: "" })
		expect(filter.push("safe")).toEqual({ blocked: true, text: "" })
		expect(filter.finish()).toBe("")
	})

	it("holds back the longest term tail so a split match is still caught", () => {
		const filter = createBlacklistFilter(["blocked"])

		expect(filter.push("blocke")).toEqual({ blocked: false, text: "" })
		expect(filter.push("d")).toEqual({ blocked: true, text: "" })
	})

	it("emits text only beyond the held-back tail", () => {
		const filter = createBlacklistFilter(["blocked"])

		expect(filter.push("0123456789")).toEqual({ blocked: false, text: "012" })
		expect(filter.finish()).toBe("3456789")
	})
})
