import { describe, expect, test } from "bun:test"

import type { ChatMessage, SessionState } from "./types.ts"

import { ChatTransportError, createChatHttpClient } from "./http-client.ts"

const API_URL = "https://api.example.test/root/"
const EMBED_TOKEN = "embed/token ?"
const CREDENTIAL = "22222222-2222-4222-8222-222222222222"
const APPEARANCE = {
	light: { primary: "#111111", textOnPrimary: "#ffffff", background: "#ffffff", surface: "#eeeeee", text: "#111111" },
	dark: { primary: "#eeeeee", textOnPrimary: "#111111", background: "#111111", surface: "#222222", text: "#ffffff" },
	position: "bottom-right",
	theme: "system",
	themeToggle: true,
	language: "en",
} as const

function recordingFetch(responses: Response[]) {
	const calls: { url: string; init: RequestInit | undefined }[] = []
	const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		calls.push({ url: input instanceof Request ? input.url : String(input), init })
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

describe("chat HTTP client", () => {
	test.each([undefined, "true", 0])("rejects malformed availability (%j)", async (isAvailable) => {
		const fake = recordingFetch([jsonResponse({ name: "Support", appearance: APPEARANCE, isAvailable })])
		const client = createChatHttpClient({ fetch: fake.fetch })
		expect(await rejectedDetail(client.loadConfiguration(context()))).toEqual({ code: "invalid-response", status: 200 })
	})

	test("loads canonical embed configuration and maps name to title", async () => {
		const fake = recordingFetch([
			jsonResponse({ version: 1, name: "Support", appearance: APPEARANCE, isAvailable: false }),
		])
		const client = createChatHttpClient({ fetch: fake.fetch })
		expect(await client.loadConfiguration(context())).toEqual({
			title: "Support",
			appearance: APPEARANCE,
			isAvailable: false,
		})
		expect(fake.calls[0]).toMatchObject({
			url: "https://api.example.test/api/embed-config/embed%2Ftoken%20%3F",
			init: { method: "GET", headers: { Accept: "application/json" } },
		})
		expect(fake.calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
	})

	test("loads and validates bearer-authenticated history", async () => {
		const history: SessionState = {
			messages: [
				{
					id: "message",
					role: "assistant",
					text: "Hello",
					parts: [{ type: "text", text: "Hello" }],
					createdAt: "2026-09-12T12:00:00Z",
					outcome: "completed",
				},
			],
			activeGeneration: { id: "generation" },
		}
		const fake = recordingFetch([jsonResponse(history)])
		const client = createChatHttpClient({ fetch: fake.fetch })
		expect(await client.loadSession({ ...context(), credential: CREDENTIAL })).toEqual(history)
		expect(fake.calls[0]).toMatchObject({
			url: "https://api.example.test/api/chat/session",
			init: { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${CREDENTIAL}` } },
		})
	})

	test("maps unknown API error codes to invalid-response", async () => {
		const fake = recordingFetch([problem("not-a-public-chat-code", 400)])
		const client = createChatHttpClient({ fetch: fake.fetch })
		expect(await rejectedDetail(client.loadSession({ ...context(), credential: CREDENTIAL }))).toEqual({
			code: "invalid-response",
			status: 400,
		})
	})

	test("accepts additive JSON fields and rejects malformed consumed fields without exposing raw bodies", async () => {
		const fake = recordingFetch([
			jsonResponse({ version: 1, name: "Support", appearance: { ...APPEARANCE, extra: true }, isAvailable: true }),
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
						parts: [{ type: "text", text: "Hello" }],
						createdAt: "2026-09-12T12:00:00Z",
						outcome: "completed",
						extra: true,
					},
				],
			}),
			jsonResponse({ version: 1, name: 42, appearance: APPEARANCE }),
			jsonResponse({
				messages: [
					{ id: "message", role: "assistant", text: 42, createdAt: "2026-09-12T12:00:00Z", outcome: "completed" },
				],
			}),
		])
		const client = createChatHttpClient({ fetch: fake.fetch })
		expect(await client.loadConfiguration(context())).toEqual({
			title: "Support",
			appearance: { ...APPEARANCE, extra: true },
			isAvailable: true,
		})
		expect(await rejectedDetail(client.loadConfiguration(context()))).toEqual({
			code: "embed-not-found",
			type: "https://docs.talqo.chat/problems#embed-not-found",
			status: 404,
		})
		expect(await client.loadSession({ ...context(), credential: CREDENTIAL })).toEqual({
			messages: [
				{
					id: "message",
					role: "assistant",
					text: "Hello",
					parts: [{ type: "text", text: "Hello" }],
					createdAt: "2026-09-12T12:00:00Z",
					outcome: "completed",
					extra: true,
				} as ChatMessage,
			],
			activeGeneration: undefined,
		})
		expect(await rejectedDetail(client.loadConfiguration(context()))).toMatchObject({
			code: "invalid-response",
			status: 200,
		})
		expect(await rejectedDetail(client.loadSession({ ...context(), credential: CREDENTIAL }))).toMatchObject({
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
			problem("provider-error", 400),
		])
		const client = createChatHttpClient({ fetch: fake.fetch, now: () => now })
		expect(
			await Promise.all(Array.from({ length: 4 }, () => rejectedDetail(client.loadConfiguration(context())))),
		).toEqual([
			{
				code: "chat-daily-allowance-exceeded",
				type: "https://docs.talqo.chat/problems#chat-daily-allowance-exceeded",
				status: 429,
				retryAt: "2026-09-13T00:00:00Z",
			},
			{
				code: "chat-concurrency-limit",
				type: "https://docs.talqo.chat/problems#chat-concurrency-limit",
				status: 429,
				retryAt: "2026-09-12T12:00:15.000Z",
			},
			{
				code: "chat-session-unauthorized",
				type: "https://docs.talqo.chat/problems#chat-session-unauthorized",
				status: 401,
			},
			{ code: "provider-error", type: "https://docs.talqo.chat/problems#provider-error", status: 400 },
		])
	})

	test("uses bearer-authenticated cancellation", async () => {
		const fake = recordingFetch([new Response(null, { status: 204 })])
		const client = createChatHttpClient({ fetch: fake.fetch })
		await client.cancelResponse({ ...context(), credential: CREDENTIAL, generationId: "generation" })
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

	test("forwards abort to fetch", async () => {
		const controller = new AbortController()
		let fetchSignal: AbortSignal | undefined
		const client = createChatHttpClient({
			fetch: async (_input, init) => {
				fetchSignal = init?.signal instanceof AbortSignal ? init.signal : undefined
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
				})
			},
		})
		const loading = client.loadConfiguration(context(controller.signal))
		controller.abort(new Error("stop fetch"))
		await expect(loading).rejects.toThrow("stop fetch")
		expect(fetchSignal).toBe(controller.signal)
	})
})
