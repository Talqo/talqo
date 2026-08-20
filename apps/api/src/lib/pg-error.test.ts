import { describe, expect, it } from "bun:test"

import { isForeignKeyViolation, isRestrictViolation, isUniqueViolation } from "./pg-error.ts"

/** Mirrors how drizzle-orm surfaces a driver error: the Postgres code sits on `.cause`. */
function wrapped(code: string): Error {
	return new Error("Failed query", { cause: Object.assign(new Error("driver"), { code }) })
}

describe("pg error predicates", () => {
	it("recognizes a unique violation", () => {
		expect(isUniqueViolation(wrapped("23505"))).toBe(true)
	})

	it("recognizes the 23503 an insert raises for a missing parent row", () => {
		expect(isForeignKeyViolation(wrapped("23503"))).toBe(true)
	})

	// ON DELETE RESTRICT reports 23001, so matching only 23503 would let the raw error escape.
	it("recognizes the 23001 an ON DELETE RESTRICT raises", () => {
		expect(isRestrictViolation(wrapped("23001"))).toBe(true)
		expect(isForeignKeyViolation(wrapped("23001"))).toBe(false)
		expect(isRestrictViolation(wrapped("23503"))).toBe(false)
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
