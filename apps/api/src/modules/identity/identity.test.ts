import {
	CREDENTIAL_MAX_LENGTH,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
} from "@talqo/shared"
import { describe, expect, it } from "bun:test"

import { changePasswordRequestSchema, loginRequestSchema } from "./identity.contract.ts"
import {
	assertValidPassword,
	assertValidUsername,
	InvalidPasswordFormatError,
	InvalidUsernameError,
	toPublicUser,
} from "./identity.service.ts"

describe("assertValidUsername", () => {
	it("accepts a username within length and character constraints", () => {
		expect(() => assertValidUsername("valid_user-123")).not.toThrow()
	})

	it("accepts usernames at the documented length limits", () => {
		expect(() => assertValidUsername("a".repeat(USERNAME_MIN_LENGTH))).not.toThrow()
		expect(() => assertValidUsername("a".repeat(USERNAME_MAX_LENGTH))).not.toThrow()
	})

	it("rejects a username shorter than the minimum length", () => {
		expect(() => assertValidUsername("ab")).toThrow(InvalidUsernameError)
		expect(() => assertValidUsername("ab")).toThrow("Username must be between 3 and 32 characters")
	})

	it("rejects a username longer than the maximum length", () => {
		expect(() => assertValidUsername("a".repeat(33))).toThrow(InvalidUsernameError)
	})

	it("rejects a username with disallowed characters", () => {
		expect(() => assertValidUsername("invalid user!")).toThrow(InvalidUsernameError)
		expect(() => assertValidUsername("invalid user!")).toThrow(
			"Username may only contain letters, numbers, underscores, and hyphens",
		)
	})
})

describe("credential request schemas", () => {
	it.each([
		["login", (oversized: string) => loginRequestSchema.safeParse({ password: oversized, username: oversized })],
		[
			"password change",
			(oversized: string) =>
				changePasswordRequestSchema.safeParse({ currentPassword: oversized, newPassword: "valid-password" }),
		],
	])("rejects %s credentials longer than the maximum before hashing", (_label, parse) => {
		expect(parse("x".repeat(CREDENTIAL_MAX_LENGTH + 1)).success).toBe(false)
	})
})

describe("assertValidPassword", () => {
	it("accepts a password within length constraints", () => {
		expect(() => assertValidPassword("correct-horse-battery-staple")).not.toThrow()
	})

	it("accepts passwords at the documented length limits", () => {
		expect(() => assertValidPassword("p".repeat(PASSWORD_MIN_LENGTH))).not.toThrow()
		expect(() => assertValidPassword("p".repeat(PASSWORD_MAX_LENGTH))).not.toThrow()
	})

	it("rejects a password shorter than the minimum length", () => {
		expect(() => assertValidPassword("short")).toThrow(InvalidPasswordFormatError)
		expect(() => assertValidPassword("short")).toThrow("Password must be between 8 and 128 characters")
	})

	it("rejects a password longer than the maximum length", () => {
		expect(() => assertValidPassword("a".repeat(PASSWORD_MAX_LENGTH + 1))).toThrow(InvalidPasswordFormatError)
	})
})

describe("toPublicUser", () => {
	it("strips the password hash and timestamps from a user row", () => {
		const user = {
			id: "user-1",
			username: "alice",
			passwordHash: "hash",
			mustChangePassword: false,
			createdAt: new Date(),
			updatedAt: new Date(),
		}

		expect(toPublicUser(user)).toEqual({ id: "user-1", username: "alice", mustChangePassword: false })
	})
})
