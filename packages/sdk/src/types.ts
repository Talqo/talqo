import type { ProblemDetails } from "./generated/contracts.ts"
import type { AsyncStorage } from "./storage.ts"

export type ChatConfiguration = {
	readonly title: string
	readonly appearance: Readonly<Record<string, unknown>>
	/** Requires an enabled embed and a usable text provider. */
	readonly isAvailable: boolean
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
	readonly id: string
	readonly role: ChatMessageRole
	readonly text: string
	readonly createdAt: string
	readonly outcome: ChatMessageOutcome
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
	"embed-disabled",
	"embed-not-found",
	"request-failed",
] as const satisfies readonly ProblemDetails["code"][]

const SDK_ERROR_CODES = [
	"invalid-response",
	"transport-error",
	"storage-unavailable",
	"cancel-failed",
	"reset-failed",
	"chat-unavailable",
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
	/** False before configuration loads or when the embed cannot reply. Turn errors do not change availability. */
	readonly isAvailable: boolean
	readonly configuration: ChatConfiguration | undefined
	readonly messages: readonly ChatMessage[]
	readonly activity: "idle" | "loading" | "sending" | "responding" | "stopping" | "recovering" | "resetting" | "blocked"
	readonly actions: readonly ("send" | "stop" | "retry" | "new-chat")[]
	readonly notices: readonly ("storage-unavailable" | "recovery-unavailable")[]
	readonly acceptedMessageId: string | undefined
	readonly activeTools: readonly ActiveTool[]
	readonly error: ChatError | undefined
}

export type SessionState = {
	readonly messages: readonly ChatMessage[]
	readonly activeGeneration: { readonly id: string } | undefined
}

export type ActiveTool = { readonly serverName: string; readonly toolName: string }

export type ChatEvent =
	| {
			type: "accepted"
			requestId: string
			generationId: string
			userMessage: { id: string; createdAt: string }
			assistantMessage: { id: string; createdAt: string }
	  }
	| { type: "delta"; assistantMessageId: string; text: string }
	| { type: "tool-start"; serverName: string; toolName: string }
	| { type: "tool-end"; serverName: string; toolName: string; outcome: "completed" | "failed" | "cancelled" }
	| { type: "terminal"; outcome: Exclude<ChatMessageOutcome, "pending" | "streaming"> }
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
