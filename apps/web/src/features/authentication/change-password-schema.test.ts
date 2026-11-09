import { expectValidationIssue } from "@/testing/schema-assertions"
import { describe, test } from "bun:test"

import { changePasswordSchema, forcedPasswordChangeSchema, resetPasswordSchema } from "./change-password-schema.ts"

const currentPassword = "correct-horse-battery-staple"
const newPassword = "new-correct-horse-battery"

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
		expectValidationIssue(cases, "confirmPassword", "passwordMismatch")
	})
})
