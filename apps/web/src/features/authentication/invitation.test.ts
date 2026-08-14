import { ApiError } from "@/api/errors.ts"
import { describe, expect, test } from "bun:test"

import { buildInvitationUrl, getInvitationErrorMessage } from "./invitation.ts"

describe("buildInvitationUrl", () => {
	test("builds an absolute invitation URL and encodes the token", () => {
		expect(buildInvitationUrl("https://talqo.example/dashboard", "token with spaces")).toBe(
			"https://talqo.example/accept-invite?token=token+with+spaces",
		)
	})
})

describe("getInvitationErrorMessage", () => {
	const messages = {
		fallback: "Try again.",
		permissionDenied: "You do not have permission to invite members.",
	}

	test("returns a friendly permission message for forbidden responses", () => {
		expect(getInvitationErrorMessage(new ApiError(403, "Missing users:invite permission"), messages)).toBe(
			messages.permissionDenied,
		)
	})

	test("keeps other API messages", () => {
		expect(getInvitationErrorMessage(new ApiError(409, "Conflict"), messages)).toBe("Conflict")
	})

	test("uses the fallback for unexpected errors", () => {
		expect(getInvitationErrorMessage(new Error("network failed"), messages)).toBe(messages.fallback)
	})
})
