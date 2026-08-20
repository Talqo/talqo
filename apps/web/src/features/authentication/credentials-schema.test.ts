import { describe, expect, test } from "bun:test"

import {
	credentialsFormSchema,
	invitationRegistrationFormSchema,
	registrationFormSchema,
} from "./credentials-schema.ts"

const username = "admin_user"
const password = "correct-horse-battery-staple"

describe("credentialsFormSchema", () => {
	test("does not require password confirmation for login", () => {
		const result = credentialsFormSchema.safeParse({ password, username })
		expect(result.success).toBe(true)
	})
})

describe("registrationFormSchema", () => {
	test("rejects mismatched password confirmation", () => {
		const result = registrationFormSchema.safeParse({
			confirmPassword: "different-password",
			password,
			username,
		})

		expect(result.success).toBe(false)
	})

	test("accepts matching password confirmation", () => {
		const result = registrationFormSchema.safeParse({
			confirmPassword: password,
			password,
			username,
		})

		expect(result.success).toBe(true)
	})
})

describe("invitationRegistrationFormSchema", () => {
	test("derives an invitation form without requiring its URL token", () => {
		const result = invitationRegistrationFormSchema.safeParse({
			confirmPassword: password,
			password,
			username,
		})

		expect(result.success).toBe(true)
	})
})
