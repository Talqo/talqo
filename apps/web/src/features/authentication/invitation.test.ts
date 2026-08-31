import { describe, expect, test } from "bun:test"

import { buildInvitationUrl, formatInvitationExpiry } from "./invitation.ts"

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
