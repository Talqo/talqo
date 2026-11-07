import { describe, expect, test } from "bun:test"

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

		for (const { schema, input } of cases) {
			const result = schema.safeParse(input)
			expect(result.success).toBe(false)
			if (!result.success) {
				const issue = result.error.issues.find((entry) => entry.path.join(".") === "confirmPassword")
				expect(issue?.message).toBe("passwordMismatch")
			}
		}
	})
})
