import { describe, expect, it } from "bun:test"
import { Hono } from "hono"

import { rejectMalformedJson, rejectOversizedBody } from "./json-body.ts"

const DEFAULT_LIMIT = 262_144

function app() {
	return new Hono()
		.use(rejectOversizedBody)
		.use(rejectMalformedJson)
		.post("/api/agents", (c) => c.json({ ok: true }))
}

function post(path: string, body: string, contentType = "application/json") {
	return app().fetch(
		new Request(`http://localhost${path}`, {
			body,
			headers: { "Content-Type": contentType, "Content-Length": String(body.length) },
			method: "POST",
		}),
	)
}

describe("rejectOversizedBody", () => {
	it.each([
		["/api/chat/cancel", 1_024, 200],
		["/api/chat/cancel", 262_144, 413],
		["/api/agents", 1_024, 200],
		["/api/agents", 262_144, 413],
	] as const)("limits JSON bodies on %s (%i bytes)", async (path, size, status) => {
		const routeApp = new Hono()
			.use(rejectOversizedBody)
			.use(rejectMalformedJson)
			.post(path, (c) => c.json({ ok: true }))
		const body = JSON.stringify({ name: "a".repeat(size) })
		const response = await routeApp.request(path, {
			method: "POST",
			body,
			headers: { "Content-Type": "application/json", "Content-Length": String(body.length) },
		})
		expect(response.status).toBe(status)
	})

	it("only applies the limit to JSON content types", async () => {
		const payload = "a".repeat(DEFAULT_LIMIT + 1)
		const response = await app().fetch(
			new Request("http://localhost/api/agents", {
				body: payload,
				headers: { "Content-Type": "text/plain", "Content-Length": String(payload.length) },
				method: "POST",
			}),
		)
		expect(response.status).toBe(200)
	})
})

describe("rejectMalformedJson", () => {
	it("rejects malformed JSON on a matched route", async () => {
		const response = await post("/api/agents", "{oops")

		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ code: "malformed-json" })
	})

	it("leaves malformed bodies on unmatched routes to the router", async () => {
		const response = await post("/api/missing", "{oops")

		expect(response.status).toBe(404)
	})

	it("does not parse bodies sent with a non-JSON content type", async () => {
		expect((await post("/api/agents", "{oops", "text/plain")).status).toBe(200)
	})

	it("accepts an empty body that declares a zero content length", async () => {
		const response = await app().fetch(
			new Request("http://localhost/api/agents", {
				headers: { "Content-Type": "application/json", "Content-Length": "0" },
				method: "POST",
			}),
		)

		expect(response.status).toBe(200)
	})
})
