import { describe, expect, test } from "bun:test"

import { changePasswordSchema, forcedPasswordChangeSchema, resetPasswordSchema } from "./change-password-schema.ts"

const currentPassword = "correct-horse-battery-staple"
const newPassword = "new-correct-horse-battery"

describe("changePasswordSchema", () => {
	test("rejects an empty current password", () => {
		const result = changePasswordSchema.safeParse({
			currentPassword: "",
			newPassword,
			confirmPassword: newPassword,
		})

		expect(result.success).toBe(false)
	})
})

describe("password confirmation", () => {
	test("rejects a mismatched confirm password with a passwordMismatch issue", () => {
		const cases = [
			{
				schema: changePasswordSchema,
				input: { currentPassword, newPassword, confirmPassword: "different-password" },
			},
			{
				schema: forcedPasswordChangeSchema,
				input: { newPassword, confirmPassword: "different-password" },
			},
			{
				schema: resetPasswordSchema,
				input: { newPassword, confirmPassword: "different-password" },
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
