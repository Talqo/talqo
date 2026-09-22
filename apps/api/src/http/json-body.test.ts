import { describe, expect, test } from "bun:test"
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
	const body = `{"requestId":"${crypto.randomUUID()}","text":"${"\\ud83d\\ude00".repeat(escapePairs)}"}`
	return {
		body,
		headers: { "Content-Type": "application/json", "Content-Length": String(body.length) },
		method: "POST",
	}
}

describe("rejectOversizedBody", () => {
	test("accepts a fully escaped chat message at the advertised allowance", async () => {
		const response = await app().fetch(
			new Request("http://localhost/api/chat/embed/messages", escapedChatBody(CHAT_LIMIT_CODE_POINTS)),
		)
		expect(response.status).toBe(200)
	})

	test("rejects a chat body beyond the transport ceiling", async () => {
		const response = await app().fetch(
			new Request("http://localhost/api/chat/embed/messages", escapedChatBody(CHAT_LIMIT_CODE_POINTS + 1_000)),
		)
		expect(response.status).toBe(413)
	})

	test("keeps the default body limit on non-chat routes", async () => {
		for (const size of [1_024, DEFAULT_LIMIT]) {
			const payload = JSON.stringify({ name: "a".repeat(size) })
			// oxlint-disable-next-line no-await-in-loop -- statuses are asserted per size.
			const response = await app().fetch(
				new Request("http://localhost/api/agents", {
					body: payload,
					headers: { "Content-Type": "application/json", "Content-Length": String(payload.length) },
					method: "POST",
				}),
			)
			expect(response.status).toBe(size < DEFAULT_LIMIT ? 200 : 413)
		}
	})
})
