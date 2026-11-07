import { describe, expect, test } from "bun:test"

import { buildInvitationUrl } from "./invitation.ts"

describe("buildInvitationUrl", () => {
	test("builds the accept-invite URL with an encoded token", () => {
		expect(buildInvitationUrl("https://example.com", "a+b/c?d=e&f#g%")).toBe(
			"https://example.com/accept-invite?token=a%2Bb%2Fc%3Fd%3De%26f%23g%25",
		)
	})
})
