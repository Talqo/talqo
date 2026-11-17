import { describe, expect, test } from "bun:test"

import { createTestChatTransport } from "./test-chat-transport"

const AGENT_ID = "4d1f5e4e-6a8b-4c3e-9f0a-1b2c3d4e5f60"
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222"
const REQUEST_ID = "11111111-1111-4111-8111-111111111111"

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input
	return input instanceof URL ? input.href : input.url
}

describe("createTestChatTransport", () => {
	test("addresses the agent's test-chat routes with the session cookie, never a bearer token", async () => {
		const calls: { url: string; init: RequestInit | undefined }[] = []
		const responses = [
			new Response(JSON.stringify({ messages: [] }), { headers: { "Content-Type": "application/json" } }),
			new Response('event: chat\ndata: {"version":1,"type":"terminal","outcome":"completed"}\n\n', {
				headers: { "Content-Type": "text/event-stream" },
			}),
			new Response(null, { status: 204 }),
		]
		const transport = createTestChatTransport(AGENT_ID, async (input, init) => {
			calls.push({ url: requestUrl(input), init })
			const response = responses.shift()
			if (!response) throw new Error("unexpected fetch")
			return response
		})
		const context = { apiUrl: "http://localhost", signal: new AbortController().signal, credential: CONVERSATION_ID }

		expect(await transport.loadConfiguration(context)).toMatchObject({ isAvailable: true })
		await transport.loadSession(context)
		await Array.fromAsync(await transport.sendMessage({ ...context, requestId: REQUEST_ID, text: "hi" }))
		await transport.cancelResponse(context)

		const base = `http://localhost/api/agents/${AGENT_ID}/test-chat`
		expect(calls.map((call) => call.url)).toEqual([
			`${base}/conversations/${CONVERSATION_ID}`,
			`${base}/messages`,
			`${base}/conversations/${CONVERSATION_ID}/cancel`,
		])
		expect(calls.every((call) => call.init?.credentials === "include")).toBe(true)
		const body = calls[1]?.init?.body
		expect(typeof body === "string" && JSON.parse(body)).toEqual({
			requestId: REQUEST_ID,
			text: "hi",
			conversationId: CONVERSATION_ID,
		})
	})
})
