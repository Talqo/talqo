import { describe, expect, test } from "bun:test"

import { assertSeedAllowed } from "./seed-policy.ts"

describe("development seed safety", () => {
	test("requires a development or test environment even with explicit opt-in", () => {
		for (const environment of ["production", "staging", ""]) {
			expect(() => assertSeedAllowed(environment, "true")).toThrow(
				"Database seeding is available only in development or test",
			)
		}
	})

	test("requires explicit opt-in before creating predictable credentials", () => {
		for (const environment of ["development", "test"]) {
			for (const optIn of [undefined, "", "false", "TRUE"]) {
				expect(() => assertSeedAllowed(environment, optIn)).toThrow("TALQO_ALLOW_INSECURE_SEED=true is required")
			}
			expect(() => assertSeedAllowed(environment, "true")).not.toThrow()
		}
	})
})
