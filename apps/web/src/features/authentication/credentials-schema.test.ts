import {
	bootstrapAdminBodyPasswordMax,
	bootstrapAdminBodyPasswordMin,
	bootstrapAdminBodyUsernameMax,
	bootstrapAdminBodyUsernameMin,
	bootstrapAdminBodyUsernameRegExp,
} from "@/api/generated/models/roles/bootstrapAdminBody.zod.ts"
import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	USERNAME_PATTERN,
} from "@talqo/shared"
import { describe, expect, test } from "bun:test"

import {
	credentialsFormSchema,
	invitationRegistrationFormSchema,
	registrationFormSchema,
} from "./credentials-schema.ts"

const username = "admin_user"
const password = "correct-horse-battery-staple"

describe("generated wire schema", () => {
	test("keeps registration constraints aligned with the shared credential policy", () => {
		expect(bootstrapAdminBodyUsernameMin).toBe(USERNAME_MIN_LENGTH)
		expect(bootstrapAdminBodyUsernameMax).toBe(USERNAME_MAX_LENGTH)
		expect(bootstrapAdminBodyUsernameRegExp.source).toBe(USERNAME_PATTERN.source)
		expect(bootstrapAdminBodyPasswordMin).toBe(PASSWORD_MIN_LENGTH)
		expect(bootstrapAdminBodyPasswordMax).toBe(PASSWORD_MAX_LENGTH)
	})
})

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
