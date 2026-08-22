import { describe, expect, test } from "bun:test"

import { buildInvitationUrl, formatInvitationExpiry, getInvitationErrorMessage } from "./invitation.ts"

describe("buildInvitationUrl", () => {
	test("builds an absolute invitation URL and encodes the token", () => {
		expect(buildInvitationUrl("https://talqo.example/dashboard", "token with spaces")).toBe(
			"https://talqo.example/accept-invite?token=token+with+spaces",
		)
	})
})

describe("formatInvitationExpiry", () => {
	test("formats the expiry in the selected app language", () => {
		expect(formatInvitationExpiry("2026-08-21T14:00:00.000Z", "en", "UTC")).toBe("Aug 21, 2026, 2:00 PM")
	})
})

describe("getInvitationErrorMessage", () => {
	const messages = {
		fallback: "Try again.",
		permissionDenied: "You do not have permission to invite members.",
	}

	test("returns a friendly permission message for forbidden responses", () => {
		const error = { info: { error: "Missing users:invite permission" }, status: 403 }
		expect(getInvitationErrorMessage(error, messages)).toBe(messages.permissionDenied)
	})

	test("keeps other API messages", () => {
		const error = { info: { error: "Conflict" }, status: 409 }
		expect(getInvitationErrorMessage(error, messages)).toBe("Conflict")
	})

	test("uses the fallback for unexpected errors", () => {
		expect(getInvitationErrorMessage(new Error("network failed"), messages)).toBe(messages.fallback)
	})
})
