import { describe, expect, it } from "bun:test"

import { isForeignKeyViolation, isRestrictViolation, isUniqueViolation } from "./pg-error.ts"

/** drizzle-orm surfaces the Postgres code on `.cause`. */
function wrapped(code: string): Error {
	return new Error("Failed query", { cause: Object.assign(new Error("driver"), { code }) })
}

describe("pg error predicates", () => {
	it("recognizes a unique violation", () => {
		expect(isUniqueViolation(wrapped("23505"))).toBe(true)
	})

	it("recognizes the 23503 an insert raises for a missing parent row", () => {
		expect(isForeignKeyViolation(wrapped("23503"))).toBe(true)
		expect(isForeignKeyViolation(wrapped("23001"))).toBe(false)
	})

	// Postgres 18 reports a blocked delete as 23001; older servers report 23503.
	it("recognizes an ON DELETE RESTRICT on either server generation", () => {
		expect(isRestrictViolation(wrapped("23001"))).toBe(true)
		expect(isRestrictViolation(wrapped("23503"))).toBe(true)
		expect(isRestrictViolation(wrapped("23505"))).toBe(false)
	})

	it("reads the code straight off an unwrapped driver error", () => {
		expect(isUniqueViolation(Object.assign(new Error("driver"), { code: "23505" }))).toBe(true)
	})

	it("ignores errors that carry no Postgres code", () => {
		expect(isUniqueViolation(new Error("network down"))).toBe(false)
		expect(isForeignKeyViolation(undefined)).toBe(false)
		expect(isRestrictViolation("not an error")).toBe(false)
	})
})
