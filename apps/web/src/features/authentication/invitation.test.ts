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
	const EXPIRY = "2026-08-21T14:00:00.000Z"

	// Piecewise: CLDR moved the date/time separator from "," to " at ", so an ICU upgrade
	// alone breaks a pinned string.
	test("formats the expiry in the selected app language", () => {
		const formatted = formatInvitationExpiry(EXPIRY, "en", "UTC")

		expect(formatted).toContain("Aug 21, 2026")
		expect(formatted).toContain("2:00")
		expect(formatted).toContain("PM")
	})

	test("renders the instant in the requested time zone", () => {
		expect(formatInvitationExpiry(EXPIRY, "en", "Asia/Tokyo")).toContain("11:00")
	})

	test("follows the requested language down to its clock convention", () => {
		expect(formatInvitationExpiry(EXPIRY, "cs", "UTC")).toContain("14:00")
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
