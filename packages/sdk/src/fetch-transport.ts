import type { ChatError, ChatEvent, ChatTransport } from "./types"

import { ChatEventV1, EmbedConfig, GetChatSessionResponse, ProblemDetails } from "./generated/contracts"
import { parseSseStream } from "./sse"

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type FetchChatTransportOptions = {
	fetch?: FetchImplementation
	now?: () => Date
}

export class ChatTransportError extends Error {
	readonly detail: ChatError

	constructor(detail: ChatError) {
		super(detail.message)
		this.name = "ChatTransportError"
		this.detail = detail
	}
}

const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR = 500
const MILLISECONDS_PER_SECOND = 1_000
const JSON_HEADERS = { Accept: "application/json" } as const
const JSON_POST_HEADERS = { Accept: "application/json", "Content-Type": "application/json" } as const
const SSE_POST_HEADERS = { Accept: "text/event-stream", "Content-Type": "application/json" } as const

function endpoint(apiUrl: string, path: string): string {
	const url = new URL(apiUrl)
	url.pathname = path
	url.search = ""
	url.hash = ""
	return url.toString()
}

async function* responseChunks(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
	const reader = body.getReader()
	const abort = () => void reader.cancel(signal.reason)
	if (signal.aborted) {
		await reader.cancel(signal.reason)
		throw signal.reason
	}
	signal.addEventListener("abort", abort, { once: true })
	try {
		while (true) {
			// oxlint-disable-next-line no-await-in-loop -- stream chunks must be read sequentially.
			const result = await reader.read()
			if (signal.aborted) throw signal.reason
			if (result.done) return
			yield result.value
		}
	} finally {
		signal.removeEventListener("abort", abort)
		reader.releaseLock()
	}
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
	if (!response.body) throw invalidResponse(response.status)
	const chunks: Uint8Array[] = []
	let length = 0
	for await (const chunk of responseChunks(response.body, signal)) {
		chunks.push(chunk)
		length += chunk.length
	}
	const bytes = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.length
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes)) as unknown
	} catch {
		throw invalidResponse(response.status)
	}
}

function invalidResponse(status: number): ChatTransportError {
	return new ChatTransportError({
		code: "invalid-response",
		status,
		message: "The chat service returned an invalid response",
		retriable: status >= HTTP_SERVER_ERROR,
		newChatAvailable: false,
	})
}

function errorPolicy(code: string, status?: number): Pick<ChatError, "message" | "retriable" | "newChatAvailable"> {
	switch (code) {
		case "chat-daily-allowance-exceeded":
			return { message: "The network message allowance has been reached", retriable: true, newChatAvailable: false }
		case "chat-concurrency-limit":
		case "chat-session-busy":
			return { message: "Chat generation is temporarily busy", retriable: true, newChatAvailable: false }
		case "provider-unreachable":
		case "provider-rate-limited":
		case "request-failed":
		case "internal-server-error":
		case "transport_error":
			return { message: "Chat service is temporarily unavailable", retriable: true, newChatAvailable: false }
		case "chat-conversation-too-long":
		case "chat-context-limit":
			return { message: "This conversation cannot accept another message", retriable: false, newChatAvailable: true }
		case "chat-session-unauthorized":
			return { message: "The chat session is unauthorized", retriable: false, newChatAvailable: true }
		case "embed-not-found":
			return { message: "The chat embed is unavailable", retriable: false, newChatAvailable: false }
		default:
			return {
				message: "The chat request failed",
				retriable: status === HTTP_TOO_MANY_REQUESTS || (status !== undefined && status >= HTTP_SERVER_ERROR),
				newChatAvailable: false,
			}
	}
}

function retryAt(response: Response, now: () => Date): string | undefined {
	const reset = response.headers.get("X-RateLimit-Reset")
	if (reset !== null && !Number.isNaN(Date.parse(reset))) return reset
	const retryAfter = response.headers.get("Retry-After")
	if (retryAfter === null) return undefined
	const seconds = Number(retryAfter)
	if (Number.isFinite(seconds) && seconds >= 0) {
		return new Date(now().getTime() + seconds * MILLISECONDS_PER_SECOND).toISOString()
	}
	if (!Number.isNaN(Date.parse(retryAfter))) return new Date(retryAfter).toISOString()
	return undefined
}

function normalizeStreamError(error: { code: string; retryAt?: string }): ChatError {
	return {
		code: error.code,
		...errorPolicy(error.code),
		...(error.retryAt === undefined ? {} : { retryAt: error.retryAt }),
	}
}

async function problemError(response: Response, signal: AbortSignal, now: () => Date): Promise<ChatTransportError> {
	if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("application/problem+json")) {
		return invalidResponse(response.status)
	}
	const value = await readJson(response, signal)
	const parsed = ProblemDetails.safeParse(value)
	if (!parsed.success) return invalidResponse(response.status)
	const retry = retryAt(response, now)
	return new ChatTransportError({
		code: parsed.data.code,
		type: parsed.data.type,
		status: response.status,
		...errorPolicy(parsed.data.code, response.status),
		...(retry === undefined ? {} : { retryAt: retry }),
	})
}

async function requireSuccess(response: Response, signal: AbortSignal, now: () => Date): Promise<void> {
	if (!response.ok) throw await problemError(response, signal, now)
}

function parseChatEvent(value: unknown, eventName: string | undefined): ChatEvent | undefined {
	if (eventName !== "chat") return undefined
	const parsed = ChatEventV1.safeParse(value)
	if (!parsed.success) return undefined
	const { version: _version, ...event } = parsed.data
	if (event.type === "error") return { ...event, error: normalizeStreamError(event.error) }
	return event
}

export function createFetchChatTransport(options: FetchChatTransportOptions = {}): ChatTransport {
	const fetchImplementation = options.fetch ?? globalThis.fetch
	const now = options.now ?? (() => new Date())

	return {
		async loadConfiguration(input) {
			const response = await fetchImplementation(
				endpoint(input.apiUrl, `/api/embed-config/${encodeURIComponent(input.embedToken)}`),
				{ method: "GET", signal: input.signal, headers: JSON_HEADERS },
			)
			await requireSuccess(response, input.signal, now)
			const value = await readJson(response, input.signal)
			const parsed = EmbedConfig.safeParse(value)
			if (!parsed.success) throw invalidResponse(response.status)
			return { title: parsed.data.name, appearance: parsed.data.appearance }
		},

		async loadSession(input) {
			const response = await fetchImplementation(endpoint(input.apiUrl, "/api/chat/session"), {
				method: "GET",
				signal: input.signal,
				headers: { ...JSON_HEADERS, Authorization: `Bearer ${input.credential}` },
			})
			await requireSuccess(response, input.signal, now)
			const value = await readJson(response, input.signal)
			const parsed = GetChatSessionResponse.safeParse(value)
			if (!parsed.success) throw invalidResponse(response.status)
			return { messages: parsed.data.messages, activeGeneration: parsed.data.activeGeneration }
		},

		async sendMessage(input) {
			const response = await fetchImplementation(
				endpoint(input.apiUrl, `/api/chat/${encodeURIComponent(input.embedToken)}/messages`),
				{
					method: "POST",
					signal: input.signal,
					headers: { ...SSE_POST_HEADERS, Authorization: `Bearer ${input.credential}` },
					body: JSON.stringify({ requestId: input.requestId, text: input.text }),
				},
			)
			await requireSuccess(response, input.signal, now)
			if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("text/event-stream") || !response.body) {
				throw invalidResponse(response.status)
			}
			return parseSseStream(responseChunks(response.body, input.signal), parseChatEvent)
		},

		async cancelResponse(input) {
			const response = await fetchImplementation(endpoint(input.apiUrl, "/api/chat/cancel"), {
				method: "POST",
				signal: input.signal,
				headers: { ...JSON_POST_HEADERS, Authorization: `Bearer ${input.credential}` },
				body: JSON.stringify(input.generationId === undefined ? {} : { generationId: input.generationId }),
			})
			await requireSuccess(response, input.signal, now)
		},
	}
}
