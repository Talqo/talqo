import { handleError } from "@/app.ts"
import { type Annotate, createWideEvents, type WideEvent } from "@/http/wide-event.ts"
import { EmbedNotFoundError } from "@/modules/embed/embed.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { describe, expect, it } from "bun:test"

import { chatEventSchema } from "./conversation.contract.ts"
import { EmbedDisabledError, ProviderUnavailableError } from "./conversation.errors.ts"
import { createConversationRoutes } from "./conversation.routes.ts"

const REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const CREDENTIAL = "22222222-2222-4222-8222-222222222222"

function parseEvents(body: string) {
	return body
		.split("\n\n")
		.filter(Boolean)
		.map((frame) => chatEventSchema.parse(JSON.parse(frame.split("\ndata: ")[1] ?? "null")))
}

// "late-error" holds the stream open until `release`, like a generation still running after the 200.
function routes(failure: "disabled" | "embed" | "late-error" | "none" | "pre-accept" = "none") {
	const calls: unknown[] = []
	const gate = Promise.withResolvers<void>()
	const service = {
		send: async (input: unknown, emit: (event: unknown) => void, annotate?: Annotate) => {
			calls.push(input)
			annotate?.({ "agent.id": "agent", "embed.id": "embed-id", "rag.chunks": 2 })
			if (failure === "embed") throw new EmbedNotFoundError()
			if (failure === "disabled") throw new EmbedDisabledError()
			if (failure === "pre-accept") throw new ProviderUnavailableError()
			annotate?.({ "chat.duplicate": false })
			const accepted = {
				version: 1 as const,
				type: "accepted" as const,
				requestId: REQUEST_ID,
				generationId: "generation",
				userMessage: { id: "user", createdAt: "2026-09-11T00:00:00.000Z" },
				assistantMessage: { id: "assistant", createdAt: "2026-09-11T00:00:00.001Z" },
			}
			emit(accepted)
			if (failure === "late-error") {
				const done = (async () => {
					await gate.promise
					emit({ version: 1, type: "tool-start", serverName: "shop", toolName: "lookup" })
					emit({
						version: 1,
						type: "error",
						outcome: "failed",
						error: { code: "provider-error", retriable: true, newChatAvailable: false },
					})
				})()
				return { ...accepted, duplicate: false, done }
			}
			emit({ version: 1, type: "tool-start", serverName: "shop", toolName: "lookup" })
			emit({ version: 1, type: "tool-end", serverName: "shop", toolName: "lookup", outcome: "failed" })
			emit({ version: 1, type: "delta", assistantMessageId: "assistant", text: "hello" })
			emit({ version: 1, type: "terminal", outcome: "completed" })
			return { ...accepted, duplicate: false, done: Promise.resolve() }
		},
		getSession: async () => ({ messages: [], activeGeneration: undefined }),
		cancel: async () => undefined,
	}
	const logged: WideEvent[] = []
	const app = new OpenAPIHono()
		.use(
			"*",
			createWideEvents((event) => logged.push(event)),
		)
		.route(
			"/chat",
			createConversationRoutes(service, () => ({ peerAddress: "::ffff:192.0.2.4", forwardedFor: undefined })),
		)
	app.onError(handleError)
	return { app, calls, logged, release: () => gate.resolve() }
}

describe("public conversation routes", () => {
	it("streams typed POST SSE and derives the network from the peer", async () => {
		const { app, calls } = routes()
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, text: "hi" }),
		})

		expect(response.status).toBe(200)
		expect(response.headers.get("content-type")).toContain("text/event-stream")
		const body = await response.text()
		expect(body).toContain("event: chat")
		expect(parseEvents(body).map((event) => event.type)).toEqual([
			"accepted",
			"tool-start",
			"tool-end",
			"delta",
			"terminal",
		])
		expect(calls[0]).toMatchObject({ credential: CREDENTIAL, embedToken: "embed" })
		expect(typeof (calls[0] as { networkHash?: unknown } | undefined)?.networkHash).toBe("string")
	})

	it("logs one wide event describing the generation without the chat credential", async () => {
		const { app, logged } = routes()
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, text: "hi" }),
		})
		await response.text()

		expect(logged).toHaveLength(1)
		expect(logged[0]).toMatchObject({
			"http.route": "/chat/:embedToken/messages",
			"http.response.status_code": 200,
			"agent.id": "agent",
			"embed.id": "embed-id",
			"generation.id": "generation",
			"chat.outcome": "completed",
			"chat.duplicate": false,
			"chat.tool_calls": 1,
			"chat.tool_failures": 1,
			"rag.chunks": 2,
		})
		expect(JSON.stringify(logged)).not.toContain(CREDENTIAL)
		expect(JSON.stringify(logged)).not.toContain('"hi"')
	})

	it("logs fields from events emitted after the response starts streaming", async () => {
		const { app, logged, release } = routes("late-error")
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, text: "hi" }),
		})

		expect(response.status).toBe(200)
		expect(logged).toBeEmpty()
		release()
		expect(parseEvents(await response.text()).map((event) => event.type)).toEqual(["accepted", "tool-start", "error"])
		expect(logged).toHaveLength(1)
		expect(logged[0]).toMatchObject({
			"chat.outcome": "failed",
			"chat.tool_calls": 1,
			"error.code": "provider-error",
			"http.response.status_code": 200,
		})
	})

	it("requires a bearer credential for POST /chat/embed/messages", async () => {
		const { app } = routes()
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, text: "hi" }),
		})

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({
			code: "chat-session-unauthorized",
			type: "https://docs.talqo.chat/problems#chat-session-unauthorized",
		})
	})

	it("rejects generation when no trustworthy peer address exists", async () => {
		const app = new OpenAPIHono().route(
			"/chat",
			createConversationRoutes(
				{
					send: async () => ({
						version: 1 as const,
						type: "accepted" as const,
						requestId: REQUEST_ID,
						generationId: "generation",
						userMessage: { id: "user", createdAt: "2026-09-11T00:00:00.000Z" },
						assistantMessage: { id: "assistant", createdAt: "2026-09-11T00:00:00.001Z" },
						duplicate: false,
						done: Promise.resolve(),
					}),
					getSession: async () => ({ messages: [], activeGeneration: undefined }),
					cancel: async () => undefined,
				},
				() => ({ peerAddress: undefined, forwardedFor: undefined }),
			),
		)
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, text: "hi" }),
		})
		expect(response.status).toBe(400)
	})

	it("rejects non-v4 request IDs before calling the service", async () => {
		const { app, calls } = routes()
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: "11111111-1111-1111-8111-111111111111", text: "hi" }),
		})

		expect(response.status).toBe(400)
		expect(response.headers.get("content-type")).toContain("application/problem+json")
		expect(calls).toBeEmpty()
	})

	it("returns an RFC problem when provider preparation fails before acceptance", async () => {
		const { app } = routes("pre-accept")
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, text: "hi" }),
		})

		expect(response.status).toBe(502)
		expect(response.headers.get("content-type")).toContain("application/problem+json")
		expect(await response.json()).toMatchObject({ code: "provider-error" })
	})

	it("maps an invalid or rotated embed token before streaming", async () => {
		const { app } = routes("embed")
		const response = await app.request("/chat/rotated/messages", {
			method: "POST",
			headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, text: "hi" }),
		})

		expect(response.status).toBe(404)
		expect(await response.json()).toMatchObject({ code: "embed-not-found" })
	})

	it("rejects a message to a disabled embed with embed-disabled before streaming", async () => {
		const { app } = routes("disabled")
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, text: "hi" }),
		})

		expect(response.status).toBe(403)
		expect(response.headers.get("content-type")).toContain("application/problem+json")
		expect(await response.json()).toMatchObject({ code: "embed-disabled" })
	})
})
