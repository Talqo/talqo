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

	it("emits all safe buffered output when finished", () => {
		const filter = createBlacklistFilter(["blocked"])
		const emitted = filter.push("safe text")
		expect(emitted.blocked).toBe(false)
		expect(emitted.text + filter.finish()).toBe("safe text")
	})
})
