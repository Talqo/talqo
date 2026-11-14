import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"

import { generateOpaqueToken, hashOpaqueToken } from "./opaque-token.ts"

describe("opaque tokens", () => {
	it("generates 32 random bytes encoded as base64url", () => {
		const token = generateOpaqueToken()

		expect(Buffer.from(token, "base64url")).toHaveLength(32)
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
		expect(generateOpaqueToken()).not.toBe(token)
	})

	it("hashes with SHA-256 so stored digests never reveal the token", () => {
		expect(hashOpaqueToken("token")).toBe("3c469e9d6c5875d37a43f353d4f88e61fcf812c66eee3457465a40b0da4153e0")
		expect(hashOpaqueToken("token")).toBe(createHash("sha256").update("token").digest("hex"))
		expect(hashOpaqueToken("token")).not.toBe(hashOpaqueToken("other"))
	})
})
