import { describe, expect, test } from "bun:test"

import { ChatTransportError, createFetchChatTransport, type ChatErrorCode, type ChatEvent } from "./index"

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

function recordingFetch(responses: Response[]) {
	const calls: FetchCall[] = []
	const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		calls.push({ url: String(input), init })
		const response = responses.shift()
		if (!response) throw new Error("unexpected fetch")
		return response
	}
	return { calls, fetch }
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(value), {
		...init,
		headers: { "Content-Type": "application/json", ...init.headers },
	})
}

function problem(code: string, status: number, headers: HeadersInit = {}): Response {
	return jsonResponse(
		{ code, type: `https://docs.talqo.chat/problems#${code}` },
		{ status, headers: { "Content-Type": "application/problem+json", ...headers } },
	)
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

function context(signal = new AbortController().signal) {
	return { apiUrl: API_URL, embedToken: EMBED_TOKEN, signal }
}

async function rejectedDetail(action: Promise<unknown>) {
	try {
		await action
		throw new Error("expected rejection")
	} catch (error) {
		expect(error).toBeInstanceOf(ChatTransportError)
		return (error as ChatTransportError).detail
	}
}

describe("createFetchChatTransport", () => {
	test("exports the complete supported chat error code set", () => {
		const codes = [
			"invalid-request",
			"malformed-json",
			"chat-client-address-unavailable",
			"chat-conversation-too-long",
			"chat-daily-allowance-exceeded",
			"chat-concurrency-limit",
			"chat-session-busy",
			"chat-request-conflict",
			"chat-session-unauthorized",
			"chat-context-limit",
			"chat-input-incompatible",
			"payload-too-large",
			"provider-error",
			"internal-server-error",
			"embed-not-found",
			"request-failed",
			"invalid-response",
			"transport-error",
			"storage-unavailable",
			"cancel-failed",
			"reset-failed",
		] as const satisfies readonly ChatErrorCode[]

		expect(codes).toHaveLength(21)
	})

	test("loads canonical embed configuration and maps name to title", async () => {
		const fake = recordingFetch([jsonResponse({ version: 1, name: "Support", appearance: APPEARANCE })])
		const transport = createFetchChatTransport({ fetch: fake.fetch })

		expect(await transport.loadConfiguration(context())).toEqual({ title: "Support", appearance: APPEARANCE })
		expect(fake.calls).toEqual([
			{
				url: "https://api.example.test/api/embed-config/embed%2Ftoken%20%3F",
				init: { method: "GET", signal: expect.any(AbortSignal), headers: { Accept: "application/json" } },
			},
		])
	})

	test("loads and validates bearer-authenticated history", async () => {
		const history = {
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
		expect(fake.calls[0]).toEqual({
			url: "https://api.example.test/api/chat/session",
			init: {
				method: "GET",
				signal: expect.any(AbortSignal),
				headers: { Accept: "application/json", Authorization: `Bearer ${CREDENTIAL}` },
			},
		})
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
			{
				type: "error",
				outcome: "failed",
				error: {
					code: "provider-error",
					retryAt: "2026-09-12T12:05:00Z",
					retriable: false,
					newChatAvailable: true,
				},
			},
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

		expect(await Array.fromAsync(await transport.sendMessage(input))).toEqual([
			{
				type: "error",
				outcome: "failed",
				error: {
					code: "provider-error",
					retryAt: "raw-retry-value",
					retriable: false,
					newChatAvailable: true,
				},
			},
		])
		expect(await rejectedDetail(transport.loadSession({ ...context(), credential: CREDENTIAL }))).toEqual({
			code: "provider-error",
			type: "https://docs.talqo.chat/problems#provider-error",
			status: 400,
		})
	})

	test("maps unknown and malformed API error codes to invalid-response", async () => {
		const fake = recordingFetch([
			problem("not-a-public-chat-code", 400),
			jsonResponse(
				{ code: 42, type: "https://docs.talqo.chat/problems#invalid-request" },
				{ status: 400, headers: { "Content-Type": "application/problem+json" } },
			),
			streamResponse([
				'event: chat\ndata: {"version":1,"type":"error","outcome":"failed","error":{"code":"not-a-public-chat-code","retriable":true,"newChatAvailable":false}}\n\n',
			]),
			streamResponse([
				'event: chat\ndata: {"version":1,"type":"error","outcome":"failed","error":{"code":42,"retriable":true,"newChatAvailable":false}}\n\n',
			]),
		])
		const transport = createFetchChatTransport({ fetch: fake.fetch })
		const input = { ...context(), requestId: REQUEST_ID, credential: CREDENTIAL, text: "hello" }

		expect(await rejectedDetail(transport.loadSession({ ...context(), credential: CREDENTIAL }))).toEqual({
			code: "invalid-response",
			status: 400,
		})
		expect(await rejectedDetail(transport.loadSession({ ...context(), credential: CREDENTIAL }))).toEqual({
			code: "invalid-response",
			status: 400,
		})
		expect(await rejectedDetail(Array.fromAsync(await transport.sendMessage(input)))).toEqual({
			code: "invalid-response",
			status: 200,
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
			jsonResponse({ version: 1, name: "Support", appearance: { ...APPEARANCE, extra: true } }),
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

		expect(await transport.loadConfiguration(context())).toEqual({
			title: "Support",
			appearance: { ...APPEARANCE, extra: true },
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
				},
			],
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
			problem("chat-conversation-too-long", 400),
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
		expect(await rejectedDetail(transport.loadConfiguration(context()))).toEqual({
			code: "chat-conversation-too-long",
			type: "https://docs.talqo.chat/problems#chat-conversation-too-long",
			status: 400,
		})
	})

	test("uses bearer-authenticated cancellation", async () => {
		const fake = recordingFetch([new Response(null, { status: 204 })])
		const transport = createFetchChatTransport({ fetch: fake.fetch })

		await transport.cancelResponse({ ...context(), credential: CREDENTIAL, generationId: "generation" })

		expect(fake.calls[0]).toMatchObject({
			url: "https://api.example.test/api/chat/cancel",
			init: {
				body: JSON.stringify({ generationId: "generation" }),
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${CREDENTIAL}`,
					"Content-Type": "application/json",
				},
			},
		})
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
})
