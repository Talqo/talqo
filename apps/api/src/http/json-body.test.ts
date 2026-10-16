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
		.post("/api/agents", (c) => c.json({ ok: true }))
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
	it("accepts a fully escaped chat message at the advertised allowance", async () => {
		const response = await app().fetch(
			new Request("http://localhost/api/chat/embed/messages", escapedChatBody(CHAT_LIMIT_CODE_POINTS)),
		)
		expect(response.status).toBe(200)
	})

	it("rejects a chat body beyond the transport ceiling", async () => {
		const response = await app().fetch(
			new Request("http://localhost/api/chat/embed/messages", escapedChatBody(CHAT_LIMIT_CODE_POINTS + 1_000)),
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
})
