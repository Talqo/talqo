import { describe, expect, it } from "bun:test"

import { PROBLEMS } from "./problem-catalog.ts"

describe("problem catalog", () => {
	it("uses unique codes as stable anchors", () => {
		const codes = PROBLEMS.map((problem) => problem.code)

		expect(new Set(codes).size).toBe(codes.length)
		for (const code of codes) {
			expect(code).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
		}
	})
})
