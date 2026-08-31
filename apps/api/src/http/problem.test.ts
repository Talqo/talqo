import { describe, expect, it } from "bun:test"

import { PROBLEMS, PROBLEM_CODES, problemDetails, problemDetailsSchema } from "./problem.ts"

describe("problem details", () => {
	it("derives every type URI from its code", () => {
		const codes = Object.values(PROBLEM_CODES)
		expect(new Set(codes).size).toBe(codes.length)
		expect(Object.isFrozen(PROBLEMS)).toBe(true)
		for (const code of codes) {
			expect(problemDetails(code)).toEqual({
				code,
				type: `https://docs.talqo.chat/problems#${code}`,
			})
			expect(Object.isFrozen(PROBLEMS[code])).toBe(true)
		}
	})

	it("rejects properties outside the exact response contract", () => {
		const result = problemDetailsSchema.safeParse({
			...problemDetails(PROBLEM_CODES.INVALID_REQUEST),
			title: "Invalid request",
		})

		expect(result.success).toBe(false)
	})

	it("rejects a type URI that does not match its code", () => {
		const result = problemDetailsSchema.safeParse({
			code: PROBLEM_CODES.INVALID_REQUEST,
			type: "https://docs.talqo.chat/problems#internal-server-error",
		})

		expect(result.success).toBe(false)
	})

	it("publishes documentation for every problem code", async () => {
		const catalogFile = Bun.file(new URL("../../../docs/src/routes/problems.tsx", import.meta.url))

		expect(await catalogFile.exists()).toBe(true)
		const catalog = await catalogFile.text()
		for (const code of Object.values(PROBLEM_CODES)) {
			expect(catalog).toContain(`code: "${code}"`)
		}
	})
})
