import { describe, expect, test } from "bun:test"

import {
	type ChatEvent,
	type ChatMessage,
	ChatTransportError,
	createFetchChatTransport,
	type SessionState,
} from "./index"

const API_URL = "https://api.example.test/root/"
const EMBED_TOKEN = "embed/token ?"
const CREDENTIAL = "22222222-2222-4222-8222-222222222222"
const REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const APPEARANCE = {
	light: {
		primary: "#111111",
		textOnPrimary: "#ffffff",
		background: "#ffffff",
		surface: "#eeeeee",
		text: "#111111",
	},
	dark: {
		primary: "#eeeeee",
		textOnPrimary: "#111111",
		background: "#111111",
		surface: "#222222",
		text: "#ffffff",
	},
	position: "bottom-right",
	theme: "system",
	themeToggle: true,
	language: "en",
} as const

type FetchCall = { url: string; init: RequestInit | undefined }

function requestUrl(input: string | URL | Request): string {
	if (typeof input === "string") return input
	return input instanceof URL ? input.href : input.url
}

function recordingFetch(responses: Response[]) {
	const calls: FetchCall[] = []
	const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		calls.push({ url: requestUrl(input), init })
		const response = responses.shift()
		if (!response) throw new Error("unexpected fetch")
		return response
	}
	return { calls, fetch }
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers)
	if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json")
	return new Response(JSON.stringify(value), { ...init, headers })
}

function problem(code: string, status: number, headers: HeadersInit = {}): Response {
	const merged = new Headers(headers)
	if (!merged.has("Content-Type")) merged.set("Content-Type", "application/problem+json")
	return jsonResponse({ code, type: `https://docs.talqo.chat/problems#${code}` }, { status, headers: merged })
}

function streamResponse(chunks: string[]): Response {
	const encoder = new TextEncoder()
	return new Response(
		new ReadableStream<Uint8Array>({
			pull(controller) {
				const chunk = chunks.shift()
				if (chunk === undefined) controller.close()
				else controller.enqueue(encoder.encode(chunk))
			},
		}),
		{ headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
	)
}

function providerErrorResult(retryAt: string): ChatEvent {
	return {
		type: "error",
		outcome: "failed",
		error: {
			code: "provider-error",
			retryAt,
			retriable: false,
			newChatAvailable: true,
		},
	}
}

function context(signal = new AbortController().signal) {
	return { apiUrl: API_URL, embedToken: EMBED_TOKEN, signal }
}

function chatStream(payload: unknown, eventName: string | null = "chat"): Response {
	const header = eventName === null ? "" : `event: ${eventName}\n`
	return streamResponse([`${header}data: ${JSON.stringify(payload)}\n\n`])
}

async function streamedEvents(payload: unknown, eventName: string | null = "chat"): Promise<ChatEvent[]> {
	const fake = recordingFetch([chatStream(payload, eventName)])
	const transport = createFetchChatTransport({ fetch: fake.fetch })
	return Array.fromAsync(
		await transport.sendMessage({ ...context(), requestId: REQUEST_ID, credential: CREDENTIAL, text: "hello" }),
	)
}

function withAccepted(overrides: Record<string, unknown>) {
	return { ...ACCEPTED_EVENT, ...overrides }
}

const ACCEPTED_EVENT = {
	version: 1,
	type: "accepted",
	requestId: REQUEST_ID,
	generationId: "generation",
	userMessage: { id: "user", createdAt: "2026-09-12T12:00:00Z" },
	assistantMessage: { id: "assistant", createdAt: "2026-09-12T12:00:01Z" },
}

const ICON_PATH = "/api/embed-config/embed%2Ftoken%20%3F/icon?v=1"

async function rejectedDetail(action: Promise<unknown>) {
	try {
		await action
		throw new Error("expected rejection")
	} catch (error) {
		expect(error).toBeInstanceOf(ChatTransportError)
		expect((error as Error).name).toBe("ChatTransportError")
		return (error as ChatTransportError).detail
	}
}

describe("createFetchChatTransport", () => {
	test("reads an icon that is not an API path as the default icon", async () => {
		const fake = recordingFetch([
			jsonResponse({
				version: 1,
				name: "Support",
				appearance: APPEARANCE,
				iconUrl: "javascript:alert(1)",
				isAvailable: true,
			}),
		])
		const transport = createFetchChatTransport({ fetch: fake.fetch })

		expect((await transport.loadConfiguration(context())).iconUrl).toBeNull()
	})

	test("loads canonical embed configuration and maps name to title", async () => {
		const fake = recordingFetch([
			jsonResponse({ version: 1, name: "Support", appearance: APPEARANCE, iconUrl: ICON_PATH, isAvailable: false }),
		])
		const transport = createFetchChatTransport({ fetch: fake.fetch })

		expect(await transport.loadConfiguration(context())).toEqual({
			title: "Support",
			appearance: APPEARANCE,
			iconUrl: `https://api.example.test${ICON_PATH}`,
			isAvailable: false,
		})
		expect(fake.calls).toMatchObject([
			{
				url: "https://api.example.test/api/embed-config/embed%2Ftoken%20%3F",
				init: { method: "GET", headers: { Accept: "application/json" } },
			},
		])
		expect(fake.calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
	})

	test("loads and validates bearer-authenticated history", async () => {
		const history: SessionState = {
			messages: [
				{
					id: "message",
					role: "assistant",
					text: "Hello",
					createdAt: "2026-09-12T12:00:00Z",
					outcome: "completed",
				},
			],
			activeGeneration: { id: "generation" },
		}
		const fake = recordingFetch([jsonResponse(history)])
		const transport = createFetchChatTransport({ fetch: fake.fetch })

		expect(await transport.loadSession({ ...context(), credential: CREDENTIAL })).toEqual(history)
		expect(fake.calls[0]).toMatchObject({
			url: "https://api.example.test/api/chat/session",
			init: {
				method: "GET",
				headers: { Accept: "application/json", Authorization: `Bearer ${CREDENTIAL}` },
			},
		})
		expect(fake.calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
	})

	test("uses one bearer-authenticated send route without retries", async () => {
		const terminal = 'event: chat\ndata: {"version":1,"type":"terminal","outcome":"completed"}\n\n'
		const fake = recordingFetch([streamResponse([terminal]), streamResponse([terminal])])
		const transport = createFetchChatTransport({ fetch: fake.fetch })

		await Array.fromAsync(
			await transport.sendMessage({
				...context(),
				requestId: REQUEST_ID,
				credential: CREDENTIAL,
				text: "first",
			}),
		)
		await Array.fromAsync(
			await transport.sendMessage({
				...context(),
				requestId: REQUEST_ID,
				credential: CREDENTIAL,
				text: "second",
			}),
		)

		expect(fake.calls).toHaveLength(2)
		expect(fake.calls[0]).toMatchObject({
			url: "https://api.example.test/api/chat/embed%2Ftoken%20%3F/messages",
			init: {
				method: "POST",
				body: JSON.stringify({ requestId: REQUEST_ID, text: "first" }),
				headers: {
					Accept: "text/event-stream",
					Authorization: `Bearer ${CREDENTIAL}`,
					"Content-Type": "application/json",
				},
			},
		})
		expect(fake.calls[1]).toMatchObject({
			url: "https://api.example.test/api/chat/embed%2Ftoken%20%3F/messages",
			init: {
				method: "POST",
				body: JSON.stringify({ requestId: REQUEST_ID, text: "second" }),
				headers: {
					Accept: "text/event-stream",
					Authorization: `Bearer ${CREDENTIAL}`,
					"Content-Type": "application/json",
				},
			},
		})
	})

	test("cancels the response body when an events stream is abandoned", async () => {
		let cancelled = false
		const encoder = new TextEncoder()
		const accepted = `event: chat\ndata: ${JSON.stringify({
			version: 1,
			type: "accepted",
			requestId: REQUEST_ID,
			generationId: "generation",
			userMessage: { id: "user", createdAt: "now" },
			assistantMessage: { id: "assistant", createdAt: "now" },
		})}\n\n`
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(accepted))
				// Never closed: the server keeps streaming until the server-side generation ends.
			},
			cancel() {
				cancelled = true
			},
		})
		const transport = createFetchChatTransport({
			fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
		})

		const events = await transport.sendMessage({
			...context(),
			requestId: REQUEST_ID,
			credential: CREDENTIAL,
			text: "hi",
		})
		const iterator = events[Symbol.asyncIterator]()
		expect((await iterator.next()).done).toBe(false)
		await iterator.return?.()

		expect(cancelled).toBe(true)
	})

	test("decodes split SSE and validates all terminal variants before returning events", async () => {
		const accepted = `event: chat\ndata: ${JSON.stringify({
			version: 1,
			type: "accepted",
			requestId: REQUEST_ID,
			generationId: "generation",
			userMessage: { id: "user", createdAt: "2026-09-12T12:00:00Z" },
			assistantMessage: { id: "assistant", createdAt: "2026-09-12T12:00:01Z" },
		})}\n\n`
		const delta = 'event: chat\ndata: {"version":1,"type":"delta","assistantMessageId":"assistant","text":"Hi"}\n\n'
		const terminals = ["completed", "failed", "cancelled", "blocked", "interrupted"] as const
		const responses = terminals.map((outcome, index) =>
			streamResponse(
				index === 0
					? [
							accepted.slice(0, 13),
							accepted.slice(13) + delta.slice(0, 37),
							delta.slice(37),
							`event: chat\ndata: {"version":1,"type":"terminal","outcome":"${outcome}"}\n\n`,
						]
					: [`event: chat\ndata: {"version":1,"type":"terminal","outcome":"${outcome}"}\n\n`],
			),
		)
		const fake = recordingFetch(responses)
		const transport = createFetchChatTransport({ fetch: fake.fetch })
		const observed: ChatEvent[][] = await Promise.all(
			terminals.map(async () =>
				Array.fromAsync(
					await transport.sendMessage({ ...context(), requestId: REQUEST_ID, credential: CREDENTIAL, text: "hello" }),
				),
			),
		)

		expect(observed[0]).toEqual([
			{
				type: "accepted",
				requestId: REQUEST_ID,
				generationId: "generation",
				userMessage: { id: "user", createdAt: "2026-09-12T12:00:00Z" },
				assistantMessage: { id: "assistant", createdAt: "2026-09-12T12:00:01Z" },
			},
			{ type: "delta", assistantMessageId: "assistant", text: "Hi" },
			{ type: "terminal", outcome: "completed" },
		])
		expect(observed.slice(1).map((events) => events[0])).toEqual(
			terminals.slice(1).map((outcome) => ({ type: "terminal", outcome })),
		)
	})

	test("parses tool lifecycle events and rejects malformed tool facts", async () => {
		const valid: ChatEvent[] = [
			{ type: "tool-start", serverName: "Shopify", toolName: "get_product" },
			{ type: "tool-end", serverName: "Shopify", toolName: "get_product", outcome: "completed" },
			{ type: "tool-end", serverName: "Shopify", toolName: "get_product", outcome: "failed" },
			{ type: "tool-end", serverName: "Shopify", toolName: "get_product", outcome: "cancelled" },
		]
		const malformed = [
			{ type: "tool-start", serverName: "Shopify" },
			{ type: "tool-end", serverName: "Shopify", toolName: "get_product" },
			{ type: "tool-end", serverName: "Shopify", toolName: "get_product", outcome: "running" },
		]
		const input = { ...context(), requestId: REQUEST_ID, credential: CREDENTIAL, text: "hello" }
		const body = valid.map((event) => `event: chat\ndata: ${JSON.stringify({ version: 1, ...event })}\n\n`).join("")
		const transport = createFetchChatTransport({ fetch: async () => streamResponse([body]) })

		const observed = await Array.fromAsync(await transport.sendMessage(input))

		expect(observed).toEqual(valid)
		await Promise.all(
			malformed.map(async (event) => {
				const payload = `event: chat\ndata: ${JSON.stringify({ version: 1, ...event })}\n\n`
				const stream = createFetchChatTransport({ fetch: async () => streamResponse([payload]) })
				await expect(Array.fromAsync(await stream.sendMessage(input))).rejects.toThrow("validation")
			}),
		)
	})

	test("forwards streamed error facts, ignores additive fields, and rejects malformed protocol data", async () => {
		const streamedError = {
			version: 1,
			type: "error",
			outcome: "failed",
			error: {
				code: "provider-error",
				message: "raw provider details",
				retryAt: "2026-09-12T12:05:00Z",
				retriable: false,
				newChatAvailable: true,
			},
		}
		const fake = recordingFetch([
			streamResponse([`event: chat\ndata: ${JSON.stringify(streamedError)}\n\n`]),
			streamResponse(['event: chat\ndata: {"version":2,"type":"terminal","outcome":"completed"}\n\n']),
			streamResponse(['event: chat\ndata: {"version":1,"type":"delta","assistantMessageId":"a"}\n\n']),
			streamResponse([
				`event: chat\ndata: ${JSON.stringify({
					version: 1,
					type: "accepted",
					requestId: REQUEST_ID,
					generationId: "generation",
					userMessage: { id: "user", createdAt: "2026-09-12T12:00:00Z", extra: true },
					assistantMessage: { id: "assistant", createdAt: "2026-09-12T12:00:01Z" },
				})}\n\n`,
			]),
		])
		const transport = createFetchChatTransport({ fetch: fake.fetch })
		const input = { ...context(), requestId: REQUEST_ID, credential: CREDENTIAL, text: "hello" }

		expect(await Array.fromAsync(await transport.sendMessage(input))).toEqual([
			providerErrorResult("2026-09-12T12:05:00Z"),
		])
		await expect(Array.fromAsync(await transport.sendMessage(input))).rejects.toThrow("validation")
		await expect(Array.fromAsync(await transport.sendMessage(input))).rejects.toThrow("validation")
		expect(await Array.fromAsync(await transport.sendMessage(input))).toEqual([
			{
				type: "accepted",
				requestId: REQUEST_ID,
				generationId: "generation",
				userMessage: { id: "user", createdAt: "2026-09-12T12:00:00Z" },
				assistantMessage: { id: "assistant", createdAt: "2026-09-12T12:00:01Z" },
			},
		])
	})

	test("passes provider error facts through without SDK policy fallbacks", async () => {
		const fake = recordingFetch([
			streamResponse([
				'event: chat\ndata: {"version":1,"type":"error","outcome":"failed","error":{"code":"provider-error","message":"upstream text","retryAt":"raw-retry-value","retriable":false,"newChatAvailable":true}}\n\n',
			]),
			problem("provider-error", 400),
		])
		const transport = createFetchChatTransport({ fetch: fake.fetch })
		const input = { ...context(), requestId: REQUEST_ID, credential: CREDENTIAL, text: "hello" }

		expect(await Array.fromAsync(await transport.sendMessage(input))).toEqual([providerErrorResult("raw-retry-value")])
		expect(await rejectedDetail(transport.loadSession({ ...context(), credential: CREDENTIAL }))).toEqual({
			code: "provider-error",
			type: "https://docs.talqo.chat/problems#provider-error",
			status: 400,
		})
	})

	test("maps unknown API error codes to invalid-response", async () => {
		const fake = recordingFetch([
			problem("not-a-public-chat-code", 400),
			streamResponse([
				'event: chat\ndata: {"version":1,"type":"error","outcome":"failed","error":{"code":"not-a-public-chat-code","retriable":true,"newChatAvailable":false}}\n\n',
			]),
		])
		const transport = createFetchChatTransport({ fetch: fake.fetch })
		const input = { ...context(), requestId: REQUEST_ID, credential: CREDENTIAL, text: "hello" }

		expect(await rejectedDetail(transport.loadSession({ ...context(), credential: CREDENTIAL }))).toEqual({
			code: "invalid-response",
			status: 400,
		})
		expect(await rejectedDetail(Array.fromAsync(await transport.sendMessage(input)))).toEqual({
			code: "invalid-response",
			status: 200,
		})
	})

	test("maps malformed streamed error policy to invalid-response", async () => {
		const fake = recordingFetch([
			streamResponse([
				'event: chat\ndata: {"version":1,"type":"error","outcome":"failed","error":{"code":"provider-error","newChatAvailable":false}}\n\n',
			]),
			streamResponse([
				'event: chat\ndata: {"version":1,"type":"error","outcome":"failed","error":{"code":"provider-error","retriable":true,"newChatAvailable":"yes"}}\n\n',
			]),
		])
		const transport = createFetchChatTransport({ fetch: fake.fetch })
		const input = { ...context(), requestId: REQUEST_ID, credential: CREDENTIAL, text: "hello" }

		expect(await rejectedDetail(Array.fromAsync(await transport.sendMessage(input)))).toEqual({
			code: "invalid-response",
			status: 200,
		})
		expect(await rejectedDetail(Array.fromAsync(await transport.sendMessage(input)))).toEqual({
			code: "invalid-response",
			status: 200,
		})
	})

	test("accepts additive JSON fields and rejects malformed consumed fields without exposing raw bodies", async () => {
		const fake = recordingFetch([
			jsonResponse({
				version: 1,
				name: "Support",
				appearance: { ...APPEARANCE, extra: true },
				isAvailable: true,
			}),
			jsonResponse(
				{
					code: "embed-not-found",
					type: "https://docs.talqo.chat/problems#embed-not-found",
					detail: "database leaked",
				},
				{ status: 404, headers: { "Content-Type": "application/problem+json" } },
			),
			jsonResponse({
				messages: [
					{
						id: "message",
						role: "assistant",
						text: "Hello",
						createdAt: "2026-09-12T12:00:00Z",
						outcome: "completed",
						extra: true,
					},
				],
			}),
			jsonResponse({ version: 1, name: 42, appearance: APPEARANCE }),
			jsonResponse({
				messages: [
					{
						id: "message",
						role: "assistant",
						text: 42,
						createdAt: "2026-09-12T12:00:00Z",
						outcome: "completed",
					},
				],
			}),
		])
		const transport = createFetchChatTransport({ fetch: fake.fetch })

		// No iconUrl in the response: an older API reads as the default icon.
		expect(await transport.loadConfiguration(context())).toEqual({
			title: "Support",
			appearance: { ...APPEARANCE, extra: true },
			iconUrl: null,
			isAvailable: true,
		})
		const problemError = await rejectedDetail(transport.loadConfiguration(context()))
		expect(problemError).toEqual({
			code: "embed-not-found",
			type: "https://docs.talqo.chat/problems#embed-not-found",
			status: 404,
		})
		expect(await transport.loadSession({ ...context(), credential: CREDENTIAL })).toEqual({
			messages: [
				{
					id: "message",
					role: "assistant",
					text: "Hello",
					createdAt: "2026-09-12T12:00:00Z",
					outcome: "completed",
					extra: true,
				} as ChatMessage,
			],
			activeGeneration: undefined,
		})
		expect(await rejectedDetail(transport.loadConfiguration(context()))).toMatchObject({
			code: "invalid-response",
			status: 200,
		})
		expect(await rejectedDetail(transport.loadSession({ ...context(), credential: CREDENTIAL }))).toMatchObject({
			code: "invalid-response",
			status: 200,
		})
	})

	test("preserves stable HTTP problem facts without synthesizing policy flags", async () => {
		const now = new Date("2026-09-12T12:00:00Z")
		const fake = recordingFetch([
			problem("chat-daily-allowance-exceeded", 429, {
				"Retry-After": "9",
				"X-RateLimit-Reset": "2026-09-13T00:00:00Z",
			}),
			problem("chat-concurrency-limit", 429, { "Retry-After": "15" }),
			problem("chat-session-unauthorized", 401),
		])
		const transport = createFetchChatTransport({ fetch: fake.fetch, now: () => now })

		expect(await rejectedDetail(transport.loadConfiguration(context()))).toEqual({
			code: "chat-daily-allowance-exceeded",
			type: "https://docs.talqo.chat/problems#chat-daily-allowance-exceeded",
			status: 429,
			retryAt: "2026-09-13T00:00:00Z",
		})
		expect(await rejectedDetail(transport.loadConfiguration(context()))).toEqual({
			code: "chat-concurrency-limit",
			type: "https://docs.talqo.chat/problems#chat-concurrency-limit",
			status: 429,
			retryAt: "2026-09-12T12:00:15.000Z",
		})
		expect(await rejectedDetail(transport.loadConfiguration(context()))).toEqual({
			code: "chat-session-unauthorized",
			type: "https://docs.talqo.chat/problems#chat-session-unauthorized",
			status: 401,
		})
	})

	test("uses bearer-authenticated cancellation", async () => {
		const fake = recordingFetch([new Response(null, { status: 204 }), new Response(null, { status: 204 })])
		const transport = createFetchChatTransport({ fetch: fake.fetch })

		await transport.cancelResponse({ ...context(), credential: CREDENTIAL, generationId: "generation" })
		await transport.cancelResponse({ ...context(), credential: CREDENTIAL })

		for (const call of fake.calls) {
			expect(call).toMatchObject({
				url: "https://api.example.test/api/chat/cancel",
				init: {
					method: "POST",
					headers: {
						Accept: "application/json",
						Authorization: `Bearer ${CREDENTIAL}`,
						"Content-Type": "application/json",
					},
				},
			})
		}
		expect(fake.calls[0]?.init?.body).toBe(JSON.stringify({ generationId: "generation" }))
		expect(fake.calls[1]?.init?.body).toBe(JSON.stringify({}))
	})

	test("forwards abort to fetch and active response-body reading", async () => {
		const fetchController = new AbortController()
		let fetchSignal: AbortSignal | undefined
		const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
			fetchSignal = init?.signal instanceof AbortSignal ? init.signal : undefined
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
			})
		}
		const transport = createFetchChatTransport({ fetch })
		const loading = transport.loadConfiguration(context(fetchController.signal))
		fetchController.abort(new Error("stop fetch"))
		await expect(loading).rejects.toThrow("stop fetch")
		expect(fetchSignal).toBe(fetchController.signal)

		let bodyCancelled = false
		const readingController = new AbortController()
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				bodyCancelled = true
			},
		})
		const bodyTransport = createFetchChatTransport({
			fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
		})
		const events = await bodyTransport.sendMessage({
			...context(readingController.signal),
			requestId: REQUEST_ID,
			credential: CREDENTIAL,
			text: "hello",
		})
		const reading = events[Symbol.asyncIterator]().next()
		readingController.abort(new Error("stop read"))
		await expect(reading).rejects.toThrow("stop read")
		expect(bodyCancelled).toBe(true)
	})

	test("cancels a response body that is already aborted before the first read", async () => {
		let cancelled = false
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true
			},
		})
		const transport = createFetchChatTransport({
			fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
		})
		const controller = new AbortController()
		const events = await transport.sendMessage({
			...context(controller.signal),
			requestId: REQUEST_ID,
			credential: CREDENTIAL,
			text: "hello",
		})

		controller.abort(new Error("stop before read"))

		const guarded = Promise.race([
			events[Symbol.asyncIterator]().next(),
			Bun.sleep(100).then(() => {
				throw new Error("response body was read before the abort")
			}),
		])
		await expect(guarded).rejects.toThrow("stop before read")
		expect(cancelled).toBe(true)
	})

	test("prefers the abort reason when a response body fails while aborted", async () => {
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.error(new Error("socket closed"))
			},
		})
		const transport = createFetchChatTransport({
			fetch: async () => new Response(body, { headers: { "Content-Type": "application/json" } }),
		})
		const controller = new AbortController()
		controller.abort(new Error("stop load"))

		await expect(transport.loadConfiguration(context(controller.signal))).rejects.toThrow("stop load")
	})

	test("normalizes tool, delta, and terminal events", async () => {
		const cases: { payload: unknown; expected: ChatEvent }[] = [
			{
				payload: { version: 1, type: "delta", assistantMessageId: "assistant", text: "Hi", extra: true },
				expected: { type: "delta", assistantMessageId: "assistant", text: "Hi" },
			},
			{
				payload: { version: 1, type: "tool-start", serverName: "search", toolName: "lookup", extra: true },
				expected: { type: "tool-start", serverName: "search", toolName: "lookup" },
			},
			...(["completed", "failed", "cancelled"] as const).map((outcome) => ({
				payload: { version: 1, type: "tool-end", serverName: "search", toolName: "lookup", outcome, extra: true },
				expected: { type: "tool-end", serverName: "search", toolName: "lookup", outcome } as ChatEvent,
			})),
			{
				payload: { version: 1, type: "terminal", outcome: "blocked", extra: true },
				expected: { type: "terminal", outcome: "blocked" },
			},
			{
				payload: { ...ACCEPTED_EVENT, extra: true },
				expected: {
					type: "accepted",
					requestId: REQUEST_ID,
					generationId: "generation",
					userMessage: { id: "user", createdAt: "2026-09-12T12:00:00Z" },
					assistantMessage: { id: "assistant", createdAt: "2026-09-12T12:00:01Z" },
				},
			},
		]
		await Promise.all(
			cases.map(async ({ payload, expected }) => {
				expect(await streamedEvents(payload)).toEqual([expected])
			}),
		)
	})

	test("rejects unrecognized or malformed chat events", async () => {
		const delta = { version: 1, type: "delta", assistantMessageId: "assistant", text: "Hi" }
		const errorEvent = {
			version: 1,
			type: "error",
			outcome: "failed",
			error: { code: "provider-error", retriable: true, newChatAvailable: false },
		}
		const cases: {
			shape: string
			payload: unknown
			eventName?: string | null
		}[] = [
			{ shape: "untyped event", payload: delta, eventName: null },
			{ shape: "custom event name", payload: delta, eventName: "message" },
			{ shape: "unknown event type", payload: { version: 1, type: "heartbeat" } },
			{ shape: "accepted without requestId", payload: withAccepted({ requestId: undefined }) },
			{ shape: "accepted with numeric requestId", payload: withAccepted({ requestId: 42 }) },
			{ shape: "accepted with numeric generationId", payload: withAccepted({ generationId: 42 }) },
			{ shape: "accepted without userMessage", payload: withAccepted({ userMessage: null }) },
			{
				shape: "accepted with numeric userMessage id",
				payload: withAccepted({ userMessage: { id: 42, createdAt: "2026-09-12T12:00:00Z" } }),
			},
			{
				shape: "accepted without userMessage createdAt",
				payload: withAccepted({ userMessage: { id: "user" } }),
			},
			{ shape: "accepted without assistantMessage ids", payload: withAccepted({ assistantMessage: {} }) },
			{
				shape: "accepted with numeric assistantMessage id",
				payload: withAccepted({ assistantMessage: { id: 42, createdAt: "2026-09-12T12:00:01Z" } }),
			},
			{
				shape: "accepted without assistantMessage createdAt",
				payload: withAccepted({ assistantMessage: { id: "assistant" } }),
			},
			{
				shape: "delta with numeric assistantMessageId",
				payload: { ...delta, assistantMessageId: 42 },
			},
			{
				shape: "tool-start without toolName",
				payload: { version: 1, type: "tool-start", serverName: "search" },
			},
			{
				shape: "tool-start with numeric toolName",
				payload: { version: 1, type: "tool-start", serverName: "search", toolName: 42 },
			},
			{
				shape: "tool-end without serverName",
				payload: { version: 1, type: "tool-end", toolName: "lookup", outcome: "completed" },
			},
			{
				shape: "tool-end with unknown outcome",
				payload: { version: 1, type: "tool-end", serverName: "search", toolName: "lookup", outcome: "running" },
			},
			{ shape: "terminal streaming", payload: { version: 1, type: "terminal", outcome: "streaming" } },
			{ shape: "terminal pending", payload: { version: 1, type: "terminal", outcome: "pending" } },
			{
				shape: "error with completed outcome",
				payload: { ...errorEvent, outcome: "completed" },
			},
			{ shape: "error without error facts", payload: { ...errorEvent, error: "boom" } },
			{
				shape: "error with numeric retryAt",
				payload: { ...errorEvent, error: { ...errorEvent.error, retryAt: 42 } },
			},
		]

		await Promise.all(
			cases.map(async ({ shape, payload, eventName }) =>
				expect(streamedEvents(payload, eventName === undefined ? "chat" : eventName), shape).rejects.toThrow(
					"validation",
				),
			),
		)
	})

	test("rejects success responses that are not a chat event stream", async () => {
		const responses = [
			jsonResponse({ messages: [] }),
			new Response(null, { headers: { "Content-Type": "text/event-stream" } }),
			new Response("event: chat\ndata: {}\n\n", { headers: { "Content-Type": "text/plain" } }),
			new Response(streamResponse([]).body),
		]
		await Promise.all(
			responses.map(async (response) => {
				const transport = createFetchChatTransport({ fetch: async () => response.clone() })
				const detail = await rejectedDetail(
					transport.sendMessage({ ...context(), requestId: REQUEST_ID, credential: CREDENTIAL, text: "hello" }),
				)
				expect(detail, response.headers.get("Content-Type") ?? "no content type").toEqual({
					code: "invalid-response",
					status: 200,
				})
			}),
		)
	})

	test("maps error responses without a usable problem document to invalid-response", async () => {
		const responses = [
			new Response(null, { status: 500 }),
			new Response("<html>bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }),
			new Response("{", { status: 400, headers: { "Content-Type": "application/problem+json" } }),
			jsonResponse(
				{ code: "embed-not-found" },
				{ status: 400, headers: { "Content-Type": "application/problem+json" } },
			),
			jsonResponse([], { status: 400, headers: { "Content-Type": "application/problem+json" } }),
			jsonResponse(
				{ code: "embed-not-found", type: "https://docs.talqo.chat/problems#embed-not-found" },
				{ status: 404, headers: { "Content-Type": "text/plain" } },
			),
			new Response("not-json", { status: 200, headers: { "Content-Type": "text/html" } }),
		]
		await Promise.all(
			responses.map(async (response) => {
				const transport = createFetchChatTransport({ fetch: async () => response.clone() })
				expect(
					await rejectedDetail(transport.loadConfiguration(context())),
					`${response.status} ${response.headers.get("Content-Type") ?? "no content type"}`,
				).toEqual({ code: "invalid-response", status: response.status })
			}),
		)
	})

	test("rejects session and configuration payloads outside the published schema", async () => {
		const message = {
			id: "message",
			role: "assistant",
			text: "Hello",
			createdAt: "2026-09-12T12:00:00Z",
			outcome: "completed",
		}
		const sessionCases: { shape: string; payload: unknown }[] = [
			{ shape: "null session", payload: null },
			{ shape: "session without messages", payload: {} },
			{ shape: "session with non-array messages", payload: { messages: {} } },
			{ shape: "message with numeric id", payload: { messages: [{ ...message, id: 42 }] } },
			{ shape: "message with unknown role", payload: { messages: [{ ...message, role: "system" }] } },
			{ shape: "message with unknown outcome", payload: { messages: [{ ...message, outcome: "done" }] } },
			{ shape: "message with numeric createdAt", payload: { messages: [{ ...message, createdAt: 42 }] } },
			{
				shape: "one valid and one invalid message",
				payload: { messages: [message, { ...message, outcome: "done" }] },
			},
			{ shape: "string activeGeneration", payload: { messages: [], activeGeneration: "generation" } },
			{ shape: "numeric activeGeneration id", payload: { messages: [], activeGeneration: { id: 42 } } },
		]
		await Promise.all(
			sessionCases.map(async ({ shape, payload }) => {
				const transport = createFetchChatTransport({ fetch: async () => jsonResponse(payload) })
				expect(await rejectedDetail(transport.loadSession({ ...context(), credential: CREDENTIAL })), shape).toEqual({
					code: "invalid-response",
					status: 200,
				})
			}),
		)

		const configurationCases: { shape: string; payload: unknown }[] = [
			{ shape: "array configuration", payload: [] },
			{ shape: "array appearance", payload: { name: "Support", appearance: [] } },
			{ shape: "null appearance", payload: { name: "Support", appearance: null } },
		]
		await Promise.all(
			configurationCases.map(async ({ shape, payload }) => {
				const transport = createFetchChatTransport({ fetch: async () => jsonResponse(payload) })
				expect(await rejectedDetail(transport.loadConfiguration(context())), shape).toEqual({
					code: "invalid-response",
					status: 200,
				})
			}),
		)
	})

	test("derives retry hints only from usable rate-limit headers", async () => {
		const now = new Date("2026-09-12T12:00:00Z")
		const cases: { shape: string; headers: HeadersInit; retryAt: string }[] = [
			{ shape: "numeric Retry-After", headers: { "Retry-After": "9" }, retryAt: "2026-09-12T12:00:09.000Z" },
			{ shape: "zero Retry-After", headers: { "Retry-After": "0" }, retryAt: "2026-09-12T12:00:00.000Z" },
			{
				shape: "HTTP-date Retry-After",
				headers: { "Retry-After": "Sat, 12 Sep 2026 13:00:00 GMT" },
				retryAt: "2026-09-12T13:00:00.000Z",
			},
			{
				shape: "HTTP-date reset",
				headers: { "X-RateLimit-Reset": "2026-09-13T00:00:00Z" },
				retryAt: "2026-09-13T00:00:00Z",
			},
			{
				shape: "unusable reset falling back to Retry-After",
				headers: { "X-RateLimit-Reset": "soon", "Retry-After": "5" },
				retryAt: "2026-09-12T12:00:05.000Z",
			},
		]
		await Promise.all(
			cases.map(async ({ shape, headers, retryAt }) => {
				const transport = createFetchChatTransport({
					fetch: async () => problem("chat-concurrency-limit", 429, headers),
					now: () => now,
				})
				expect(await rejectedDetail(transport.loadConfiguration(context())), shape).toEqual({
					code: "chat-concurrency-limit",
					type: "https://docs.talqo.chat/problems#chat-concurrency-limit",
					status: 429,
					retryAt,
				})
			}),
		)

		const unusable: HeadersInit[] = [
			{ "Retry-After": "later" },
			{ "Retry-After": "Infinity" },
			{ "X-RateLimit-Reset": "soon" },
		]
		await Promise.all(
			unusable.map(async (headers) => {
				const transport = createFetchChatTransport({
					fetch: async () => problem("chat-concurrency-limit", 429, headers),
					now: () => now,
				})
				expect(await rejectedDetail(transport.loadConfiguration(context())), JSON.stringify(headers)).toEqual({
					code: "chat-concurrency-limit",
					type: "https://docs.talqo.chat/problems#chat-concurrency-limit",
					status: 429,
				})
			}),
		)
	})

	test("computes Retry-After from the current clock when no clock is injected", async () => {
		const before = Date.now()
		const transport = createFetchChatTransport({
			fetch: async () => problem("chat-concurrency-limit", 429, { "Retry-After": "5" }),
		})
		const { retryAt } = await rejectedDetail(transport.loadConfiguration(context()))
		const after = Date.now()

		expect(Date.parse(retryAt ?? "")).toBeGreaterThanOrEqual(before + 5_000)
		expect(Date.parse(retryAt ?? "")).toBeLessThanOrEqual(after + 5_000)
	})
})
