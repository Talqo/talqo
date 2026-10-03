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

describe("embed CRUD authentication boundary", () => {
	// The config routes are public; that must never leak into the CRUD namespace beside them.
	it("still requires a session to list embeds", async () => {
		expect((await app.request("/api/embeds")).status).toBe(401)
	})

	it("still requires a session to read one embed", async () => {
		expect((await app.request("/api/embeds/any-id")).status).toBe(401)
	})

	it("still requires a session to disable or enable one embed", async () => {
		expect((await app.request("/api/embeds/any-id/disable", { method: "POST" })).status).toBe(401)
		expect((await app.request("/api/embeds/any-id/enable", { method: "POST" })).status).toBe(401)
	})

	it("does not treat a config-shaped path nested under the CRUD namespace as an endpoint", async () => {
		expect((await app.request("/api/embeds/any-id/config")).status).toBe(404)
	})

	// ADR-0013 keeps one public configuration URL; the retired one must never answer as public.
	it("no longer serves the retired widget-config URL", async () => {
		expect((await app.request("/api/widget-config/any-token")).status).toBe(404)
	})

	it("does not treat a deeper path under the public prefix as an endpoint", async () => {
		expect((await app.request("/api/embed-config/token/extra")).status).toBe(404)
	})
})
