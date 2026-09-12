import { describe, expect, it } from "bun:test"

import { deriveSessionCredential, hashSecret, isCanonicalBase64Url } from "./conversation-crypto.ts"

const APP_SECRET = Buffer.alloc(32, 4).toString("base64url")

describe("conversation credentials", () => {
	it("recovers the same credential from an unambiguous bootstrap identity", () => {
		const input = { embedId: "embed", accessVersion: 2, requestId: "request", bootstrapSecret: "private" }
		expect(deriveSessionCredential(APP_SECRET, input)).toBe(deriveSessionCredential(APP_SECRET, input))
		expect(deriveSessionCredential(APP_SECRET, { ...input, requestId: "request2" })).not.toBe(
			deriveSessionCredential(APP_SECRET, input),
		)
	})

	it("hashes credentials and bootstrap secrets without retaining plaintext", () => {
		const hash = hashSecret("private")
		expect(hash).toBe(hashSecret("private"))
		expect(hash).not.toContain("private")
	})

	it("validates canonical fixed-length base64url values", () => {
		expect(isCanonicalBase64Url(Buffer.alloc(16, 1).toString("base64url"), 16)).toBe(true)
		expect(isCanonicalBase64Url(Buffer.alloc(32, 1).toString("base64url"), 32)).toBe(true)
		expect(isCanonicalBase64Url(Buffer.alloc(15, 1).toString("base64url"), 16)).toBe(false)
		expect(isCanonicalBase64Url("not+base64", 32)).toBe(false)
		expect(isCanonicalBase64Url("AQ==", 1)).toBe(false)
	})
})
