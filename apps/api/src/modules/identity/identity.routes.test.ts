import { app } from "@/app.ts"
import { describe, expect, it } from "bun:test"

describe("identity routes", () => {
	it("rejects an unauthenticated request to a non-exempt path", async () => {
		const response = await app.request("/api/me", { method: "DELETE" })

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({
			code: "authentication-required",
			type: "https://docs.talqo.chat/problems#authentication-required",
		})
	})

	it("returns a null user for a session check with no cookie, without requiring auth", async () => {
		const response = await app.request("/api/auth/session")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ user: null })
	})
})
