import { describe, expect, it } from "bun:test"

import { isRestrictViolation } from "./pg-error.ts"

/** drizzle-orm surfaces the Postgres code on `.cause`. */
function wrapped(code: string): Error {
	return new Error("Failed query", { cause: Object.assign(new Error("driver"), { code }) })
}

describe("pg error predicates", () => {
	// Postgres 18 reports a blocked delete as 23001; older servers report 23503.
	it("recognizes an ON DELETE RESTRICT on either server generation", () => {
		expect(isRestrictViolation(wrapped("23001"))).toBe(true)
		expect(isRestrictViolation(wrapped("23503"))).toBe(true)
		expect(isRestrictViolation(wrapped("23505"))).toBe(false)
	})

	it("ignores errors that carry no Postgres code", () => {
		expect(isRestrictViolation("not an error")).toBe(false)
	})
})
