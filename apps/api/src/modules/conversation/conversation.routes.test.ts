import { OpenAPIHono } from "@hono/zod-openapi"
import { describe, expect, it } from "bun:test"

import { chatEventSchema } from "./conversation.contract.ts"
import { createConversationRoutes } from "./conversation.routes.ts"

const REQUEST_ID = Buffer.alloc(16, 1).toString("base64url")
const BOOTSTRAP_SECRET = Buffer.alloc(32, 2).toString("base64url")

function parseEvents(body: string) {
	return body
		.split("\n\n")
		.filter(Boolean)
		.map((frame) => chatEventSchema.parse(JSON.parse(frame.split("\ndata: ")[1] ?? "null")))
}

function routes(failure = false) {
	const calls: unknown[] = []
	const service = {
		send: async (input: unknown, emit: (event: unknown) => void) => {
			calls.push(input)
			emit({
				version: 1,
				type: "accepted",
				requestId: REQUEST_ID,
				generationId: "generation",
				credential: "credential",
				userMessage: { id: "user", createdAt: "2026-09-11T00:00:00.000Z" },
				assistantMessage: { id: "assistant", createdAt: "2026-09-11T00:00:00.001Z" },
			})
			if (failure) {
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
				credential: "credential",
				userMessage: { id: "user", createdAt: "2026-09-11T00:00:00.000Z" },
				assistantMessage: { id: "assistant", createdAt: "2026-09-11T00:00:00.001Z" },
				duplicate: false,
				done: Promise.resolve(),
			}
		},
		getSession: async () => ({ messages: [], activeGeneration: undefined }),
		getAttempt: async () => ({ id: "generation", status: "running" as const, assistantText: "partial" }),
		recoverBootstrap: async () => ({ status: "not-accepted" as const }),
		cancelBootstrap: async () => "accepted" as const,
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
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, bootstrapSecret: BOOTSTRAP_SECRET, text: "hi" }),
		})

		expect(response.status).toBe(200)
		expect(response.headers.get("content-type")).toContain("text/event-stream")
		const body = await response.text()
		expect(body).toContain("event: chat")
		expect(parseEvents(body).map((event) => event.type)).toEqual(["accepted", "delta", "terminal"])
		expect(calls[0]).toMatchObject({ networkHash: expect.any(String), embedToken: "embed" })
	})

	it("requires a bearer credential for history and cancellation", async () => {
		const { app } = routes()
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
		const bootstrapCancel = await app.request("/chat/embed/bootstrap-cancel", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, bootstrapSecret: BOOTSTRAP_SECRET }),
		})
		expect(bootstrapCancel.status).toBe(204)
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
					recoverBootstrap: async () => ({ status: "not-accepted" as const }),
					cancelBootstrap: async () => "not-accepted" as const,
					cancel: async () => undefined,
				},
				() => ({ peerAddress: undefined, forwardedFor: undefined }),
			),
		)
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, bootstrapSecret: BOOTSTRAP_SECRET, text: "hi" }),
		})
		expect(response.status).toBe(400)
	})

	it("rejects non-canonical request and bootstrap secrets before calling the service", async () => {
		const { app, calls } = routes()
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: "request", bootstrapSecret: "bootstrap", text: "hi" }),
		})

		expect(response.status).toBe(400)
		expect(response.headers.get("content-type")).toContain("application/problem+json")
		expect(calls).toBeEmpty()
	})

	it("emits a schema-valid error event after acceptance", async () => {
		const { app } = routes(true)
		const response = await app.request("/chat/embed/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ requestId: REQUEST_ID, bootstrapSecret: BOOTSTRAP_SECRET, text: "hi" }),
		})

		expect(response.status).toBe(200)
		expect(parseEvents(await response.text()).map((event) => event.type)).toEqual(["accepted", "error"])
	})
})
