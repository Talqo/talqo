import { app as apiApp, handleError } from "@/app.ts"
import { type Annotate, createWideEvents, type WideEvent } from "@/http/wide-event.ts"
import { EmbedNotFoundError } from "@/modules/embed/embed.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { describe, expect, it } from "bun:test"
import { websocket } from "hono/bun"

import { chatClientFrameSchema } from "./conversation.contract.ts"
import { EmbedDisabledError, ProviderUnavailableError } from "./conversation.errors.ts"
import { createConversationRoutes } from "./conversation.routes.ts"

const REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const CREDENTIAL = "22222222-2222-4222-8222-222222222222"
const START = { version: 1, type: "start", credential: CREDENTIAL, requestId: REQUEST_ID, text: "hello", tools: [] }
// Mirrors TALQO_CHAT_MAX_INPUT_CHARACTERS in apps/api/.env.example.
const CHAT_INPUT_LIMIT = 400_000

function routes(
	failure: "disabled" | "embed" | "late-error" | "none" | "pre-accept" | "successful-tool" = "none",
	authorizePageResume = async () => {},
) {
	const calls: Array<unknown> = []
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
			const done = (async () => {
				if (failure === "late-error") await gate.promise
				const part = {
					type: "dynamic-tool",
					toolCallId: "lookup-call",
					toolName: "shop_lookup",
					input: {},
					toolMetadata: { source: "mcp", serverName: "shop", displayName: "lookup" },
				}
				emit({
					version: 1,
					type: "part",
					assistantMessageId: "assistant",
					index: 0,
					part: { ...part, state: "input-available" },
				})
				annotate?.({ "chat.tool_calls": 1 })
				if (failure === "late-error") {
					emit({
						version: 1,
						type: "error",
						outcome: "failed",
						error: { code: "provider-error", retriable: true, newChatAvailable: false },
					})
					return
				}
				if (failure === "successful-tool") {
					emit({
						version: 1,
						type: "part",
						assistantMessageId: "assistant",
						index: 0,
						part: {
							...part,
							state: "output-available",
							output: {},
							toolMetadata: { ...part.toolMetadata, outcome: "completed" },
						},
					})
					emit({ version: 1, type: "terminal", outcome: "completed" })
					return
				}
				emit({
					version: 1,
					type: "part",
					assistantMessageId: "assistant",
					index: 0,
					part: {
						...part,
						state: "output-error",
						errorText: "Tool failed",
						toolMetadata: { ...part.toolMetadata, outcome: "failed" },
					},
				})
				annotate?.({ "chat.tool_failures": 1 })
				emit({ version: 1, type: "part", assistantMessageId: "assistant", index: 1, part: { type: "text", text: "" } })
				emit({ version: 1, type: "delta", assistantMessageId: "assistant", index: 1, text: "hello" })
				emit({ version: 1, type: "terminal", outcome: "completed" })
			})()
			return { ...accepted, duplicate: false, done }
		},
		getSession: async () => ({ messages: [], activeGeneration: undefined }),
		cancel: async () => undefined,
		authorizePageResume,
	}
	const logged: Array<WideEvent> = []
	const loggedEvent = Promise.withResolvers<void>()
	const app = new OpenAPIHono()
		.use(
			"*",
			createWideEvents((event) => {
				logged.push(event)
				loggedEvent.resolve()
			}),
		)
		.route(
			"/chat",
			createConversationRoutes(service, () => ({ peerAddress: "::ffff:192.0.2.4", forwardedFor: undefined })),
		)
	app.onError(handleError)
	return { app, calls, logged, loggedEvent: loggedEvent.promise, release: () => gate.resolve() }
}

function serve(app: ReturnType<typeof routes>["app"]) {
	return Bun.serve({ port: 0, fetch: (request, host) => app.fetch(request, { server: host }), websocket })
}

function connect(origin: string, frame: unknown, onAccepted?: (socket: WebSocket) => void) {
	const events: Array<unknown> = []
	const accepted = Promise.withResolvers<void>()
	const socket = new WebSocket(`${origin.replace("http:", "ws:")}/chat/embed/socket`)
	const closed = new Promise<number>((resolve, reject) => {
		socket.addEventListener("open", () => socket.send(typeof frame === "string" ? frame : JSON.stringify(frame)))
		socket.addEventListener("message", (event) => {
			const message: unknown = JSON.parse(String(event.data))
			events.push(message)
			if (typeof message === "object" && message !== null && "type" in message && message.type === "accepted") {
				accepted.resolve()
				onAccepted?.(socket)
			}
		})
		socket.addEventListener("close", (event) => resolve(event.code))
		socket.addEventListener("error", reject)
	})
	return { events, accepted: accepted.promise, closed, socket }
}

describe("public conversation routes", () => {
	it("finishes the wide event when a resume socket closes during authorization", async () => {
		const authorizing = Promise.withResolvers<void>()
		const authorized = Promise.withResolvers<void>()
		const { app, loggedEvent, logged, release } = routes("late-error", async () => {
			authorizing.resolve()
			await authorized.promise
		})
		const server = serve(app)
		const pageSession = crypto.randomUUID()
		try {
			const first = connect(server.url.origin, {
				...START,
				pageSession,
				tools: [{ name: "talqo_page", inputSchema: {} }],
			})
			await first.accepted
			first.socket.close()
			await first.closed
			const resumed = connect(server.url.origin, { version: 1, type: "resume", pageSession, credential: CREDENTIAL })
			await authorizing.promise
			resumed.socket.close()
			await resumed.closed
			await loggedEvent
			expect(logged).toHaveLength(1)
		} finally {
			authorized.resolve()
			release()
			await server.stop(true)
		}
	})
	it("reattaches a page turn without accepting or charging a second request", async () => {
		const { app, calls, release } = routes("late-error")
		const server = serve(app)
		const pageSession = crypto.randomUUID()
		try {
			const first = connect(server.url.origin, {
				...START,
				pageSession,
				tools: [{ name: "talqo_page", inputSchema: {} }],
			})
			await first.accepted
			first.socket.close()
			await first.closed
			const wrong = connect(server.url.origin, {
				version: 1,
				type: "resume",
				pageSession,
				credential: crypto.randomUUID(),
			})
			expect(await wrong.closed).toBe(1008)
			const resumed = connect(server.url.origin, { version: 1, type: "resume", pageSession, credential: CREDENTIAL })
			await resumed.accepted
			const contender = connect(server.url.origin, { version: 1, type: "resume", pageSession, credential: CREDENTIAL })
			expect(await contender.closed).toBe(1008)
			expect(calls[0]).toHaveProperty("clientTools.interrupted", false)
			release()
			expect(await resumed.closed).toBe(1000)
			expect(resumed.events).toMatchObject([
				{ type: "accepted", requestId: REQUEST_ID },
				{ type: "part" },
				{ type: "error" },
			])
			expect(calls).toHaveLength(1)
		} finally {
			release()
			await server.stop(true)
		}
	})
	it("closes deeply nested tool results before authentication", async () => {
		const { app, calls } = routes()
		const server = serve(app)
		try {
			const frame = `{"version":1,"type":"tool-result","toolCallId":"call","output":${"[".repeat(10_000)}0${"]".repeat(10_000)}}`
			expect(await connect(server.url.origin, frame).closed).toBe(1008)
			expect(calls).toBeEmpty()
		} finally {
			await server.stop(true)
		}
	})

	it("rejects a browser tool result without a pending call", async () => {
		const { app, release } = routes("late-error")
		const server = serve(app)
		try {
			const tools = [{ name: "lookup", inputSchema: {} }]
			const turn = connect(server.url.origin, { ...START, tools }, (socket) =>
				socket.send(JSON.stringify({ version: 1, type: "tool-result", toolCallId: "missing", output: null })),
			)
			expect(await turn.closed).toBe(1008)
		} finally {
			release()
			await server.stop(true)
		}
	})

	it("logs failed upgrades even when no socket callbacks run", async () => {
		const { app, logged } = routes()
		const server = serve(app)
		try {
			const response = await fetch(`${server.url.origin}/chat/embed/socket`, { headers: { Upgrade: "websocket" } })
			expect(response.status).toBe(500)
			expect(logged).toHaveLength(1)
			expect(logged[0]).toMatchObject({ "http.response.status_code": 500, "error.code": "internal-server-error" })
		} finally {
			await server.stop(true)
		}
	})

	it("requires a JSON tool output within the payload limit", () => {
		const frame = { version: 1, type: "tool-result", toolCallId: "call" }
		expect(chatClientFrameSchema.safeParse({ ...frame, output: null }).success).toBe(true)
		for (const output of [undefined, Number.NaN, new Date(), "x".repeat(262_144)])
			expect(chatClientFrameSchema.safeParse({ ...frame, output }).success).toBe(false)
		expect(chatClientFrameSchema.safeParse(frame).success).toBe(false)
	})

	it("authenticates a real socket in its first frame, derives the network, and logs one credential-free wide event", async () => {
		const { app, calls, logged } = routes()
		const server = serve(app)
		try {
			const turn = connect(server.url.origin, START)
			expect(await turn.closed).toBe(1000)
			expect(turn.events).toMatchObject([
				{ type: "accepted" },
				{ type: "part", index: 0, part: { state: "input-available" } },
				{ type: "part", index: 0, part: { state: "output-error" } },
				{ type: "part", index: 1, part: { type: "text" } },
				{ type: "delta" },
				{ type: "terminal" },
			])
			expect(calls).toHaveLength(1)
			expect(calls[0]).toMatchObject({ credential: CREDENTIAL, text: "hello", embedToken: "embed" })
			expect(calls[0]).toHaveProperty("networkHash")
			expect(logged).toHaveLength(1)
			expect(logged[0]).toMatchObject({
				"http.route": "/chat/:embedToken/socket",
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
			expect(JSON.stringify(logged)).not.toContain('"hello"')
		} finally {
			await server.stop(true)
		}
	})

	it.each([
		{ version: 1, type: "cancel" },
		{ ...START, pageSession: crypto.randomUUID() },
		{ ...START, credential: undefined },
		{ ...START, requestId: "11111111-1111-1111-8111-111111111111" },
		{ ...START, tools: Array.from({ length: 9 }, (_, index) => ({ name: `tool${index}`, inputSchema: {} })) },
	])("closes invalid or over-budget starts before acceptance (%j)", async (frame) => {
		const { app, calls } = routes()
		const server = serve(app)
		try {
			expect(await connect(server.url.origin, frame).closed).toBe(1008)
			expect(calls).toBeEmpty()
		} finally {
			await server.stop(true)
		}
	})

	it.each([
		["pre-accept", "provider-error", 502],
		["embed", "embed-not-found", 404],
		["disabled", "embed-disabled", 403],
	] as const)("rejects %s failures before acceptance", async (failure, code, status) => {
		const { app } = routes(failure)
		const server = serve(app)
		try {
			const turn = connect(server.url.origin, START)
			expect(await turn.closed).toBe(1000)
			expect(turn.events).toEqual([{ version: 1, type: "rejected", code, status }])
		} finally {
			await server.stop(true)
		}
	})

	it("counts only failed tool calls", async () => {
		const { app, logged } = routes("successful-tool")
		const server = serve(app)
		try {
			expect(await connect(server.url.origin, START).closed).toBe(1000)
			expect(logged).toHaveLength(1)
			expect(logged[0]).toMatchObject({ "chat.tool_calls": 1 })
			expect(logged[0]).not.toHaveProperty("chat.tool_failures")
		} finally {
			await server.stop(true)
		}
	})

	it("closes a start frame beyond the documented input ceiling before acceptance", async () => {
		const { app, calls } = routes()
		const server = serve(app)
		try {
			// Two escaped surrogates encode one astral code point in 12 JSON bytes.
			const text = String.raw`\ud83d\ude00`.repeat(CHAT_INPUT_LIMIT + 1)
			const frame = `{"version":1,"type":"start","credential":"${CREDENTIAL}","requestId":"${REQUEST_ID}","text":"${text}","tools":[]}`
			expect(await connect(server.url.origin, frame).closed).toBe(1008)
			expect(calls).toBeEmpty()
		} finally {
			await server.stop(true)
		}
	})

	it("rejects a second start frame on one connection", async () => {
		const { app, calls, release } = routes("late-error")
		const server = serve(app)
		try {
			const events: Array<unknown> = []
			const closed = await new Promise<number>((resolve, reject) => {
				const socket = new WebSocket(`${server.url.origin.replace("http:", "ws:")}/chat/embed/socket`)
				socket.addEventListener("open", () => {
					socket.send(JSON.stringify(START))
					socket.send(JSON.stringify({ ...START, requestId: "33333333-3333-4333-8333-333333333333" }))
				})
				socket.addEventListener("message", (event) => events.push(JSON.parse(String(event.data))))
				socket.addEventListener("close", (event) => resolve(event.code))
				socket.addEventListener("error", reject)
			})
			expect(closed).toBe(1008)
			expect(calls).toHaveLength(1)
			expect(events[0]).toMatchObject({ type: "accepted" })
		} finally {
			release()
			await server.stop(true)
		}
	})

	it("logs events emitted after socket acceptance before finishing the wide event", async () => {
		const { app, logged, release } = routes("late-error")
		const server = serve(app)
		try {
			const turn = connect(server.url.origin, START)
			await turn.accepted
			expect(logged).toBeEmpty()
			release()
			expect(await turn.closed).toBe(1000)
			expect(turn.events).toMatchObject([{ type: "accepted" }, { type: "part" }, { type: "error" }])
			expect(logged).toHaveLength(1)
			expect(logged[0]).toMatchObject({
				"chat.outcome": "failed",
				"chat.tool_calls": 1,
				"error.code": "provider-error",
			})
		} finally {
			release()
			await server.stop(true)
		}
	})

	it("rejects a socket upgrade when no trustworthy peer address exists", async () => {
		const app = new OpenAPIHono().route(
			"/chat",
			createConversationRoutes(undefined, () => ({
				peerAddress: undefined,
				forwardedFor: undefined,
			})),
		)
		const response = await app.request("/chat/embed/socket", { headers: { Upgrade: "websocket" } })
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ code: "chat-client-address-unavailable" })
	})
})

describe("operator conversation authentication boundary", () => {
	it("requires a session to list or read conversations, even with a chat bearer", async () => {
		const base = "/api/conversations"
		const bearer = { headers: { Authorization: `Bearer ${CREDENTIAL}` } }
		expect((await apiApp.request(base)).status).toBe(401)
		expect((await apiApp.request(`${base}/${CREDENTIAL}`, bearer)).status).toBe(401)
	})
})
