import { describe, expect, it } from "bun:test"

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

	it("rejects a username shorter than the minimum length", () => {
		expect(() => assertValidUsername("ab")).toThrow(InvalidUsernameError)
	})

	it("rejects a username longer than the maximum length", () => {
		expect(() => assertValidUsername("a".repeat(33))).toThrow(InvalidUsernameError)
	})

	it("rejects a username with disallowed characters", () => {
		expect(() => assertValidUsername("invalid user!")).toThrow(InvalidUsernameError)
	})
})

describe("assertValidPassword", () => {
	it("accepts a password within length constraints", () => {
		expect(() => assertValidPassword("correct-horse-battery-staple")).not.toThrow()
	})

	it("rejects a password shorter than the minimum length", () => {
		expect(() => assertValidPassword("short")).toThrow(InvalidPasswordFormatError)
	})

	it("rejects a password longer than the maximum length", () => {
		expect(() => assertValidPassword("a".repeat(129))).toThrow(InvalidPasswordFormatError)
	})
})

describe("toPublicUser", () => {
	it("strips the password hash and timestamps from a user row", () => {
		const user = {
			id: "user-1",
			username: "alice",
			passwordHash: "hash",
			createdAt: new Date(),
			updatedAt: new Date(),
		}

		expect(toPublicUser(user)).toEqual({ id: "user-1", username: "alice" })
	})
})
