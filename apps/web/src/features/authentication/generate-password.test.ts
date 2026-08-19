import { describe, expect, test } from "bun:test"

import { generateRandomPassword } from "./generate-password.ts"

describe("generateRandomPassword", () => {
	test("generates a 24-character password", () => {
		expect(generateRandomPassword()).toHaveLength(24)
	})

	test("only uses letters, digits, and symbols", () => {
		expect(generateRandomPassword()).toMatch(/^[A-Za-z0-9!@#$%^&*()\-_=+]+$/)
	})

	test("generates different passwords across calls", () => {
		expect(generateRandomPassword()).not.toBe(generateRandomPassword())
	})
})
