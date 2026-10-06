import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { PROBLEMS } from "./problem-catalog.ts"

// The API owns the codes; the docs page only explains them. Read the source as
// text rather than importing it: apps never import one another.
const API_PROBLEM_FILE = join(import.meta.dir, "..", "..", "..", "api", "src", "http", "problem.ts")

function apiCodes(source: string): string[] {
	const codes: string[] = []
	for (const match of source.matchAll(/^\s*[A-Z][A-Z0-9_]*:\s*"([a-z0-9-]+)"\s*,?\s*$/gm)) {
		const code = match[1]
		if (code !== undefined) codes.push(code)
	}
	return codes
}

describe("problem catalog", () => {
	it("uses unique codes as stable anchors", () => {
		const codes = PROBLEMS.map((problem) => problem.code)

		expect(new Set(codes).size).toBe(codes.length)
		for (const code of codes) {
			expect(code).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
		}
	})

	it("covers every problem code the API can emit", async () => {
		const api = new Set(apiCodes(await readFile(API_PROBLEM_FILE, "utf8")))
		const docs = new Set(PROBLEMS.map((problem) => problem.code))

		expect(api.size).toBeGreaterThan(0)
		expect([...docs].filter((code) => !api.has(code))).toEqual([])
		expect([...api].filter((code) => !docs.has(code))).toEqual([])
	})
})
