import type {
	CancelChatGenerationBody,
	ChatEventV1,
	EmbedConfig,
	GetChatSession200,
	GetChatSession200MessagesItem,
	SendChatMessageBody,
} from "./generated/contracts"
import type { ChatError, ChatErrorCode, ChatEvent, ChatTransport } from "./types"

import { parseSseStream } from "./sse"
import { isChatErrorCode } from "./types"

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type FetchChatTransportOptions = {
	fetch?: FetchImplementation
	now?: () => Date
}

export class ChatTransportError extends Error {
	readonly detail: ChatError

	constructor(detail: ChatError) {
		super(detail.code)
		this.name = "ChatTransportError"
		this.detail = detail
	}
}

const MILLISECONDS_PER_SECOND = 1_000
const HTTP_OK = 200
const JSON_HEADERS = { Accept: "application/json" } as const
const JSON_POST_HEADERS = { Accept: "application/json", "Content-Type": "application/json" } as const
const SSE_POST_HEADERS = { Accept: "text/event-stream", "Content-Type": "application/json" } as const
const MESSAGE_ROLES = ["user", "assistant"] as const
const MESSAGE_OUTCOMES = ["streaming", "completed", "failed", "cancelled", "blocked", "interrupted"] as const
const TERMINAL_OUTCOMES = ["completed", "failed", "cancelled", "blocked", "interrupted"] as const
const ERROR_OUTCOMES = ["failed", "cancelled", "blocked", "interrupted"] as const

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
	})
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isOneOf<const Values extends readonly string[]>(value: unknown, values: Values): value is Values[number] {
	return typeof value === "string" && values.some((candidate) => candidate === value)
}

function isMessage(value: unknown): value is GetChatSession200MessagesItem {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		isOneOf(value.role, MESSAGE_ROLES) &&
		typeof value.text === "string" &&
		typeof value.createdAt === "string" &&
		isOneOf(value.outcome, MESSAGE_OUTCOMES)
	)
}

function isSession(value: unknown): value is GetChatSession200 {
	return (
		isRecord(value) &&
		Array.isArray(value.messages) &&
		value.messages.every(isMessage) &&
		(value.activeGeneration === undefined ||
			(isRecord(value.activeGeneration) && typeof value.activeGeneration.id === "string"))
	)
}

function embedConfiguration(value: unknown): EmbedConfig | undefined {
	if (!isRecord(value) || typeof value.name !== "string" || !isRecord(value.appearance)) return undefined
	return value as unknown as EmbedConfig
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

function normalizeStreamError(error: {
	code: ChatErrorCode
	retryAt?: string
	retriable: boolean
	newChatAvailable: boolean
}): ChatError {
	return {
		code: error.code,
		retriable: error.retriable,
		newChatAvailable: error.newChatAvailable,
		...(error.retryAt === undefined ? {} : { retryAt: error.retryAt }),
	}
}

async function problemError(response: Response, signal: AbortSignal, now: () => Date): Promise<ChatTransportError> {
	if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("application/problem+json")) {
		return invalidResponse(response.status)
	}
	const value = await readJson(response, signal)
	if (!isRecord(value) || !isChatErrorCode(value.code) || typeof value.type !== "string") {
		return invalidResponse(response.status)
	}
	const retry = retryAt(response, now)
	return new ChatTransportError({
		code: value.code,
		type: value.type,
		status: response.status,
		...(retry === undefined ? {} : { retryAt: retry }),
	})
}

async function requireSuccess(response: Response, signal: AbortSignal, now: () => Date): Promise<void> {
	if (!response.ok) throw await problemError(response, signal, now)
}

function parseChatEvent(value: unknown, eventName: string | undefined): ChatEvent | undefined {
	if (eventName !== "chat" || !isRecord(value) || value.version !== 1) return undefined
	if (value.type === "accepted") {
		if (
			typeof value.requestId !== "string" ||
			typeof value.generationId !== "string" ||
			!isRecord(value.userMessage) ||
			typeof value.userMessage.id !== "string" ||
			typeof value.userMessage.createdAt !== "string" ||
			!isRecord(value.assistantMessage) ||
			typeof value.assistantMessage.id !== "string" ||
			typeof value.assistantMessage.createdAt !== "string"
		) {
			return undefined
		}
		const event = {
			version: 1,
			type: "accepted",
			requestId: value.requestId,
			generationId: value.generationId,
			userMessage: { id: value.userMessage.id, createdAt: value.userMessage.createdAt },
			assistantMessage: { id: value.assistantMessage.id, createdAt: value.assistantMessage.createdAt },
		} satisfies ChatEventV1
		const { version: _version, ...result } = event
		return result
	}
	if (value.type === "delta") {
		if (typeof value.assistantMessageId !== "string" || typeof value.text !== "string") return undefined
		return { type: "delta", assistantMessageId: value.assistantMessageId, text: value.text }
	}
	if (value.type === "terminal") {
		if (!isOneOf(value.outcome, TERMINAL_OUTCOMES)) return undefined
		return { type: "terminal", outcome: value.outcome }
	}
	if (value.type === "error") {
		if (!isOneOf(value.outcome, ERROR_OUTCOMES) || !isRecord(value.error)) return undefined
		if (!isChatErrorCode(value.error.code)) throw invalidResponse(HTTP_OK)
		if (typeof value.error.retriable !== "boolean" || typeof value.error.newChatAvailable !== "boolean") {
			throw invalidResponse(HTTP_OK)
		}
		if (value.error.retryAt !== undefined && typeof value.error.retryAt !== "string") return undefined
		return {
			type: "error",
			outcome: value.outcome,
			error: normalizeStreamError({
				code: value.error.code,
				retriable: value.error.retriable,
				newChatAvailable: value.error.newChatAvailable,
				...(value.error.retryAt === undefined ? {} : { retryAt: value.error.retryAt }),
			}),
		}
	}
	return undefined
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
			const configuration = embedConfiguration(value)
			if (configuration === undefined) throw invalidResponse(response.status)
			return {
				title: configuration.name,
				appearance: configuration.appearance as unknown as Readonly<Record<string, unknown>>,
			}
		},

		async loadSession(input) {
			const response = await fetchImplementation(endpoint(input.apiUrl, "/api/chat/session"), {
				method: "GET",
				signal: input.signal,
				headers: { ...JSON_HEADERS, Authorization: `Bearer ${input.credential}` },
			})
			await requireSuccess(response, input.signal, now)
			const value = await readJson(response, input.signal)
			if (!isSession(value)) throw invalidResponse(response.status)
			return { messages: value.messages, activeGeneration: value.activeGeneration }
		},

		async sendMessage(input) {
			const body = { requestId: input.requestId, text: input.text } satisfies SendChatMessageBody
			const response = await fetchImplementation(
				endpoint(input.apiUrl, `/api/chat/${encodeURIComponent(input.embedToken)}/messages`),
				{
					method: "POST",
					signal: input.signal,
					headers: { ...SSE_POST_HEADERS, Authorization: `Bearer ${input.credential}` },
					body: JSON.stringify(body),
				},
			)
			await requireSuccess(response, input.signal, now)
			if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("text/event-stream") || !response.body) {
				throw invalidResponse(response.status)
			}
			return parseSseStream(responseChunks(response.body, input.signal), parseChatEvent)
		},

		async cancelResponse(input) {
			const body = (
				input.generationId === undefined ? {} : { generationId: input.generationId }
			) satisfies CancelChatGenerationBody
			const response = await fetchImplementation(endpoint(input.apiUrl, "/api/chat/cancel"), {
				method: "POST",
				signal: input.signal,
				headers: { ...JSON_POST_HEADERS, Authorization: `Bearer ${input.credential}` },
				body: JSON.stringify(body),
			})
			await requireSuccess(response, input.signal, now)
		},
	}
}
