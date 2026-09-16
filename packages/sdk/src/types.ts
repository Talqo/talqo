import type { ProblemDetails } from "./generated/contracts"
import type { AsyncStorage } from "./storage"

export type ChatConfiguration = {
	title: string
	appearance: Readonly<Record<string, unknown>>
}

export type ChatMessageRole = "user" | "assistant"
export type ChatMessageOutcome =
	| "pending"
	| "streaming"
	| "completed"
	| "failed"
	| "cancelled"
	| "blocked"
	| "interrupted"

export type ChatMessage = {
	id: string
	role: ChatMessageRole
	text: string
	createdAt: string
	outcome: ChatMessageOutcome
}

const API_CHAT_ERROR_CODES = [
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
] as const satisfies readonly ProblemDetails["code"][]

const SDK_ERROR_CODES = [
	"invalid-response",
	"transport-error",
	"storage-unavailable",
	"cancel-failed",
	"reset-failed",
] as const

export type ChatErrorCode = (typeof API_CHAT_ERROR_CODES)[number] | (typeof SDK_ERROR_CODES)[number]

export function isChatErrorCode(value: unknown): value is ChatErrorCode {
	return (
		typeof value === "string" &&
		(API_CHAT_ERROR_CODES.some((code) => code === value) || SDK_ERROR_CODES.some((code) => code === value))
	)
}

export type ChatError = {
	code: ChatErrorCode
	type?: string
	status?: number
	retryAt?: string
	retriable?: boolean
	newChatAvailable?: boolean
}

export type ChatSnapshot = {
	configuration: ChatConfiguration | undefined
	messages: readonly ChatMessage[]
	initialization: "idle" | "loading" | "ready" | "error"
	generation: "idle" | "sending" | "streaming" | "recovery" | "cancelling"
	reset: "idle" | "resetting"
	persistence: "persistent" | "memory"
	recovery: "idle" | "pending" | "unavailable"
	error: ChatError | undefined
	retryAt: string | undefined
}

export type SessionState = {
	messages: readonly ChatMessage[]
	activeGeneration: { id: string } | undefined
}

export type ChatEvent =
	| {
			type: "accepted"
			requestId: string
			generationId: string
			userMessage: { id: string; createdAt: string }
			assistantMessage: { id: string; createdAt: string }
	  }
	| { type: "delta"; assistantMessageId: string; text: string }
	| { type: "terminal"; outcome: Exclude<ChatMessageOutcome, "pending" | "streaming">; error?: ChatError }
	| { type: "error"; error: ChatError; outcome: Exclude<ChatMessageOutcome, "pending" | "streaming" | "completed"> }

export type TransportContext = {
	apiUrl: string
	embedToken: string
	signal: AbortSignal
}

export type ChatTransport = {
	loadConfiguration(input: TransportContext): Promise<ChatConfiguration>
	loadSession(input: TransportContext & { credential: string }): Promise<SessionState>
	sendMessage(
		input: TransportContext & {
			text: string
			requestId: string
			credential: string
		},
	): Promise<AsyncIterable<ChatEvent>>
	cancelResponse(
		input: TransportContext & {
			credential: string
			generationId?: string
		},
	): Promise<void>
}

export type ChatClientOptions = {
	apiUrl: string
	embedToken: string
	storage?: AsyncStorage
	transport?: ChatTransport
	randomUUID?: () => string
	now?: () => Date
	recoveryDelays?: readonly number[]
}

export type ChatClient = {
	subscribe(listener: () => void): () => void
	getSnapshot(): ChatSnapshot
	initialize(): Promise<void>
	sendMessage(text: string): Promise<void>
	retryLastMessage(): Promise<void>
	cancelResponse(): Promise<void>
	startNewChat(): Promise<void>
	dispose(): void
}
