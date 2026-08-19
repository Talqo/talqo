import { describe, expect, test } from "bun:test"

import { changePasswordSchema, resetPasswordSchema } from "./change-password-schema.ts"

const currentPassword = "correct-horse-battery-staple"
const newPassword = "new-correct-horse-battery"

describe("changePasswordSchema", () => {
	test("accepts matching new and confirm passwords", () => {
		const result = changePasswordSchema.safeParse({
			currentPassword,
			newPassword,
			confirmPassword: newPassword,
		})

		expect(result.success).toBe(true)
	})

	test("rejects mismatched confirm password", () => {
		const result = changePasswordSchema.safeParse({
			currentPassword,
			newPassword,
			confirmPassword: "different-password",
		})

		expect(result.success).toBe(false)
	})

	test("rejects an empty current password", () => {
		const result = changePasswordSchema.safeParse({
			currentPassword: "",
			newPassword,
			confirmPassword: newPassword,
		})

		expect(result.success).toBe(false)
	})
})

describe("resetPasswordSchema", () => {
	test("accepts matching new and confirm passwords with no current password field", () => {
		const result = resetPasswordSchema.safeParse({ newPassword, confirmPassword: newPassword })

		expect(result.success).toBe(true)
	})

	test("rejects mismatched confirm password", () => {
		const result = resetPasswordSchema.safeParse({ newPassword, confirmPassword: "different-password" })

		expect(result.success).toBe(false)
	})
})
