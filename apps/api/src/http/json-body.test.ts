import { describe, expect, it } from "bun:test"
import { Hono } from "hono"

import { rejectMalformedJson, rejectOversizedBody } from "./json-body.ts"

// Mirrors TALQO_CHAT_MAX_INPUT_CHARACTERS in apps/api/.env.example.
const CHAT_LIMIT_CODE_POINTS = 400_000
const DEFAULT_LIMIT = 262_144

function app() {
	return new Hono()
		.use(rejectOversizedBody)
		.use(rejectMalformedJson)
		.post("/api/chat/embed/messages", (c) => c.json({ ok: true }))
		.post("/api/agents/:agentId/test-chat/messages", (c) => c.json({ ok: true }))
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

// JSON-legally escaped: two \uXXXX surrogates encode one astral code point in 12 bytes.
function escapedChatBody(escapePairs: number) {
	const body = `{"requestId":"123e4567-e89b-12d3-a456-426614174000","text":"${"\\ud83d\\ude00".repeat(escapePairs)}"}`
	return {
		body,
		headers: { "Content-Type": "application/json", "Content-Length": String(body.length) },
		method: "POST",
	}
}

describe("rejectOversizedBody", () => {
	const chatSendPaths = ["/api/chat/embed/messages", "/api/agents/agent-id/test-chat/messages"]

	it.each(chatSendPaths)("accepts a fully escaped chat message at the advertised allowance on %s", async (path) => {
		const response = await app().fetch(new Request(`http://localhost${path}`, escapedChatBody(CHAT_LIMIT_CODE_POINTS)))
		expect(response.status).toBe(200)
	})

	it.each(chatSendPaths)("rejects a chat body beyond the transport ceiling on %s", async (path) => {
		const response = await app().fetch(
			new Request(`http://localhost${path}`, escapedChatBody(CHAT_LIMIT_CODE_POINTS + 1_000)),
		)
		expect(response.status).toBe(413)
	})

	it.each([
		[1_024, 200],
		[DEFAULT_LIMIT, 413],
	])("keeps the default body limit on non-chat routes (%i bytes -> %i)", async (size, status) => {
		const payload = JSON.stringify({ name: "a".repeat(size) })
		const response = await app().fetch(
			new Request("http://localhost/api/agents", {
				body: payload,
				headers: { "Content-Type": "application/json", "Content-Length": String(payload.length) },
				method: "POST",
			}),
		)
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
