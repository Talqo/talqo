import { app } from "@/app.ts"
import { describe, expect, it } from "bun:test"

describe("public embed config endpoints", () => {
	it("answers a CORS preflight, proving cors runs ahead of the auth gate", async () => {
		const response = await app.request("/api/embed-config/any-token", {
			method: "OPTIONS",
			headers: { Origin: "https://customer.example", "Access-Control-Request-Method": "GET" },
		})

		expect(response.status).toBe(204)
		expect(response.headers.get("access-control-allow-origin")).toBe("*")
	})

	it("never allows credentials, so the session cookie cannot ride along", async () => {
		const response = await app.request("/api/embed-config/any-token", {
			method: "OPTIONS",
			headers: { Origin: "https://customer.example" },
		})

		expect(response.headers.get("access-control-allow-credentials")).toBeNull()
	})
})
