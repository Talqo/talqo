import { describe, expect, it } from "bun:test"

import { isForeignKeyViolation, isRestrictViolation, isUniqueViolation } from "./pg-error.ts"

/** drizzle-orm surfaces the Postgres code on `.cause`. */
function wrapped(code: string): Error {
	return new Error("Failed query", { cause: Object.assign(new Error("driver"), { code }) })
}

function nested(depth: number, code: string): Error {
	let error: Error = Object.assign(new Error("driver"), { code })
	for (let remaining = depth; remaining > 0; remaining -= 1) error = new Error("wrapper", { cause: error })
	return error
}

describe("pg error predicates", () => {
	// Postgres 18 reports a blocked delete as 23001; older servers report 23503.
	it("recognizes an ON DELETE RESTRICT on either server generation", () => {
		expect(isRestrictViolation(wrapped("23001"))).toBe(true)
		expect(isRestrictViolation(wrapped("23503"))).toBe(true)
		expect(isRestrictViolation(wrapped("23505"))).toBe(false)
	})

	it("distinguishes unique and foreign key violations", () => {
		expect(isUniqueViolation(wrapped("23505"))).toBe(true)
		expect(isUniqueViolation(wrapped("23503"))).toBe(false)
		expect(isForeignKeyViolation(wrapped("23503"))).toBe(true)
		expect(isForeignKeyViolation(wrapped("23505"))).toBe(false)
	})

	it("inspects a bounded number of cause levels", () => {
		expect(isUniqueViolation(nested(4, "23505"))).toBe(true)
		expect(isUniqueViolation(nested(5, "23505"))).toBe(false)
	})

	it("stops at a cause that is not an Error", () => {
		expect(isUniqueViolation(new Error("wrapper", { cause: 42 }))).toBe(false)
	})

	it("ignores errors that carry no Postgres code", () => {
		expect(isRestrictViolation("not an error")).toBe(false)
		expect(isRestrictViolation(null)).toBe(false)
		expect(isRestrictViolation(new Error("plain"))).toBe(false)
	})
})
