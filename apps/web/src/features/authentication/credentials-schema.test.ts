import { expectValidationIssue } from "@/testing/schema-assertions"
import { describe, test } from "bun:test"

import { invitationRegistrationFormSchema, registrationFormSchema } from "./credentials-schema.ts"

describe("registration password confirmation", () => {
	test("rejects a mismatched confirm password with a field issue", () => {
		const password = "correct-horse-battery-staple"
		const cases = [
			{
				schema: registrationFormSchema,
				input: { username: "new-admin", password, confirmPassword: "different-password" },
			},
			{
				schema: invitationRegistrationFormSchema,
				input: { username: "invited-user", password, confirmPassword: "different-password" },
			},
		] as const

		expectValidationIssue(cases, "confirmPassword", "passwordMismatch")
	})
})
