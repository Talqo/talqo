import { EmbedNotFoundError } from "@/modules/embed/embed.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { describe, expect, it } from "bun:test"

import { chatEventSchema } from "./conversation.contract.ts"
import { createConversationRoutes } from "./conversation.routes.ts"
import { ProviderUnavailableError } from "./conversation.service.ts"

const REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const CREDENTIAL = "22222222-2222-4222-8222-222222222222"

function parseEvents(body: string) {
	return body
		.split("\n\n")
		.filter(Boolean)
		.map((frame) => chatEventSchema.parse(JSON.parse(frame.split("\ndata: ")[1] ?? "null")))
}

function routes(failure: "embed" | "none" | "post-accept" | "pre-accept" = "none") {
	const calls: unknown[] = []
	const service = {
		send: async (input: unknown, emit: (event: unknown) => void) => {
			calls.push(input)
			if (failure === "embed") throw new EmbedNotFoundError()
			if (failure === "pre-accept") throw new ProviderUnavailableError()
			emit({
				version: 1,
				type: "accepted",
				requestId: REQUEST_ID,
				generationId: "generation",
				userMessage: { id: "user", createdAt: "2026-09-11T00:00:00.000Z" },
				assistantMessage: { id: "assistant", createdAt: "2026-09-11T00:00:00.001Z" },
			})
			if (failure === "post-accept") {
				emit({
					version: 1,
					type: "error",
					outcome: "failed",
					error: {
						code: "provider-error",
						message: "The configured model could not complete the response.",
						retriable: true,
						newChatAvailable: false,
					},
				})
			} else {
				emit({ version: 1, type: "delta", assistantMessageId: "assistant", text: "hello" })
				emit({ version: 1, type: "terminal", outcome: "completed" })
			}
			return {
				version: 1 as const,
				type: "accepted" as const,
				requestId: REQUEST_ID,
				generationId: "generation",
				userMessage: { id: "user", createdAt: "2026-09-11T00:00:00.000Z" },
				assistantMessage: { id: "assistant", createdAt: "2026-09-11T00:00:00.001Z" },
				duplicate: false,
				done: Promise.resolve(),
			}
		},
		getSession: async () => ({ messages: [], activeGeneration: undefined }),
		getAttempt: async () => ({ id: "generation", status: "running" as const, assistantText: "partial" }),
		cancel: async () => undefined,
	}
	const app = new OpenAPIHono().route(
		"/chat",
		createConversationRoutes(service, () => ({ peerAddress: "::ffff:192.0.2.4", forwardedFor: undefined })),
	)
	return { app, calls }
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
		expect(parseEvents(body).map((event) => event.type)).toEqual(["accepted", "delta", "terminal"])
		expect(calls[0]).toMatchObject({ credential: CREDENTIAL, networkHash: expect.any(String), embedToken: "embed" })
	})

	it("requires a bearer credential for sends, history, and cancellation", async () => {
		const { app } = routes()
		expect(
			(
				await app.request("/chat/embed/messages", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ requestId: REQUEST_ID, text: "hi" }),
				})
			).status,
		).toBe(401)
		expect((await app.request("/chat/session")).status).toBe(401)
		expect((await app.request("/chat/cancel", { method: "POST" })).status).toBe(401)
		expect(
			(
				await app.request("/chat/session", {
					headers: { Authorization: "Bearer credential" },
				})
			).status,
		).toBe(200)
		const attempt = await app.request("/chat/attempts/generation", {
			headers: { Authorization: "Bearer credential" },
		})
		expect(attempt.status).toBe(200)
		expect(await attempt.json()).toEqual({ id: "generation", status: "running", assistantText: "partial" })
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
					getAttempt: async () => ({ id: "generation", status: "running" as const, assistantText: "" }),
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

	it("emits a schema-valid error event after acceptance", async () => {
		const { app } = routes("post-accept")
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, text: "hi" }),
		})

		expect(response.status).toBe(200)
		expect(parseEvents(await response.text()).map((event) => event.type)).toEqual(["accepted", "error"])
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
})
