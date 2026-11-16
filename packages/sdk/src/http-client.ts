import type { CancelChatGenerationBody, GetChatSession200 } from "./generated/models"
import type { ChatError, ChatTransport } from "./types.ts"

import { GetChatSession200 as sessionSchema } from "./generated/models/getChatSession200.zod.ts"
import { isChatErrorCode } from "./types.ts"

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type ChatHttpOptions = {
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

const MILLISECONDS_PER_SECOND = 1000
const JSON_HEADERS = { Accept: "application/json" } as const
const JSON_POST_HEADERS = { Accept: "application/json", "Content-Type": "application/json" } as const

function endpoint(apiUrl: string, path: string): string {
	const url = new URL(apiUrl)
	url.pathname = path
	url.search = ""
	url.hash = ""
	return url.toString()
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
	try {
		return (await response.json()) as unknown
	} catch {
		if (signal.aborted) throw signal.reason
		throw invalidResponse(response.status)
	}
}

function invalidResponse(status: number): ChatTransportError {
	return new ChatTransportError({ code: "invalid-response", status })
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

type EmbedConfiguration = {
	appearance: Readonly<Record<string, unknown>>
	isAvailable: boolean
	name: string
	pageControl?: { readonly enabled: boolean; readonly approvalInstructions?: string }
}

function embedConfiguration(value: unknown): EmbedConfiguration | undefined {
	if (
		!isRecord(value) ||
		typeof value.name !== "string" ||
		typeof value.isAvailable !== "boolean" ||
		!isRecord(value.appearance)
	) {
		return undefined
	}
	const pageControl = value.pageControl
	if (pageControl !== undefined) {
		if (!isRecord(pageControl) || typeof pageControl.enabled !== "boolean") return undefined
		if (pageControl.approvalInstructions !== undefined && typeof pageControl.approvalInstructions !== "string")
			return undefined
	}
	return {
		appearance: value.appearance,
		isAvailable: value.isAvailable,
		name: value.name,
		...(pageControl === undefined
			? {}
			: {
					pageControl: {
						enabled: pageControl.enabled,
						approvalInstructions: pageControl.approvalInstructions,
					},
				}),
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

async function requireSuccess(response: Response, signal: AbortSignal, now: () => Date): Promise<void> {
	if (response.ok) return
	if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("application/problem+json")) {
		throw invalidResponse(response.status)
	}
	const value = await readJson(response, signal)
	if (!isRecord(value) || !isChatErrorCode(value.code) || typeof value.type !== "string") {
		throw invalidResponse(response.status)
	}
	const retry = retryAt(response, now)
	throw new ChatTransportError({
		code: value.code,
		type: value.type,
		status: response.status,
		...(retry === undefined ? {} : { retryAt: retry }),
	})
}

export function createChatHttpClient(
	options: ChatHttpOptions = {},
): Pick<ChatTransport, "loadConfiguration" | "loadSession" | "cancelResponse"> {
	const fetchImplementation = options.fetch ?? globalThis.fetch
	const now = options.now ?? (() => new Date())
	return {
		async loadConfiguration(input) {
			const response = await fetchImplementation(
				endpoint(input.apiUrl, `/api/embed-config/${encodeURIComponent(input.embedToken)}`),
				{ method: "GET", signal: input.signal, headers: JSON_HEADERS },
			)
			await requireSuccess(response, input.signal, now)
			const configuration = embedConfiguration(await readJson(response, input.signal))
			if (configuration === undefined) throw invalidResponse(response.status)
			return {
				title: configuration.name,
				appearance: configuration.appearance,
				isAvailable: configuration.isAvailable,
				pageControl: configuration.pageControl,
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
			if (!sessionSchema.safeParse(value).success) throw invalidResponse(response.status)
			const session = value as GetChatSession200
			return { messages: session.messages, activeGeneration: session.activeGeneration }
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
