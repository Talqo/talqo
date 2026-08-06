import { app } from "@/app.ts"
import { describe, expect, it } from "bun:test"

describe("roles routes", () => {
	it("rejects a malformed JSON body with 400, not a raw parse error", async () => {
		const response = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{not valid json",
		})

		expect(response.status).toBe(400)
	})

	it("rejects a bootstrap request missing required fields", async () => {
		const response = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		})

		expect(response.status).toBe(400)
	})

	it("rejects an invitation redemption request missing required fields", async () => {
		const response = await app.request("/api/invitations/redeem", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		})

		expect(response.status).toBe(400)
	})

	it("rejects an unauthenticated request to create an invitation", async () => {
		const response = await app.request("/api/invitations", { method: "POST" })

		expect(response.status).toBe(401)
	})
})
