import { app } from "@/app.ts"
import { describe, expect, it } from "bun:test"

describe("public widget config endpoint", () => {
	it("answers a CORS preflight, proving cors runs ahead of the auth gate", async () => {
		const response = await app.request("/api/widget-config/any-token", {
			method: "OPTIONS",
			headers: { Origin: "https://customer.example", "Access-Control-Request-Method": "GET" },
		})

		expect(response.status).toBe(204)
		expect(response.headers.get("access-control-allow-origin")).toBe("*")
	})

	it("never allows credentials, so the session cookie cannot ride along", async () => {
		const response = await app.request("/api/widget-config/any-token", {
			headers: { Origin: "https://customer.example" },
		})

		expect(response.headers.get("access-control-allow-credentials")).toBeNull()
	})
})

describe("widget CRUD authentication boundary", () => {
	// The public exemption is a pattern; widening it into this namespace is an auth bypass.
	it("still requires a session to list widgets", async () => {
		expect((await app.request("/api/widgets")).status).toBe(401)
	})

	it("still requires a session to read one widget", async () => {
		expect((await app.request("/api/widgets/any-id")).status).toBe(401)
	})

	it("does not exempt a config-shaped path nested under the CRUD namespace", async () => {
		expect((await app.request("/api/widgets/any-id/config")).status).toBe(401)
	})

	it("does not exempt a deeper path under the public prefix", async () => {
		expect((await app.request("/api/widget-config/token/extra")).status).toBe(401)
	})
})
