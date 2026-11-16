import type { ToolSet } from "ai"

import type { ClientToolManifest, MessagePart, ProblemDetails } from "./generated/models"
import type { AsyncStorage } from "./storage.ts"

export type ChatConfiguration = {
	readonly title: string
	readonly appearance: Readonly<Record<string, unknown>>
	/** Requires an enabled embed and a usable text provider. */
	readonly isAvailable: boolean
	readonly pageControl?: { readonly enabled: boolean }
}

export type ChatMessageRole = "user" | "assistant"
export type ChatMessageOutcome =
	"pending" | "streaming" | "completed" | "failed" | "cancelled" | "blocked" | "interrupted"

export type ChatMessage = {
	readonly requestId?: string
	readonly id: string
	readonly role: ChatMessageRole
	readonly text: string
	readonly parts: ReadonlyArray<MessagePart>
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
] as const satisfies ReadonlyArray<ProblemDetails["code"]>

const SDK_ERROR_CODES = [
	"website-action-uncertain",
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
	readonly messages: ReadonlyArray<ChatMessage>
	readonly activity: "idle" | "loading" | "sending" | "responding" | "stopping" | "recovering" | "resetting" | "blocked"
	readonly actions: ReadonlyArray<"send" | "stop" | "retry" | "new-chat">
	readonly notices: ReadonlyArray<"storage-unavailable" | "recovery-unavailable">
	readonly acceptedMessageId: string | undefined
	readonly activeTools: ReadonlyArray<ActiveTool>
	readonly error: ChatError | undefined
}

export type SessionState = {
	readonly messages: ReadonlyArray<ChatMessage>
	readonly activeGeneration: { readonly id: string } | undefined
}

export type ActiveTool = {
	readonly toolCallId?: string
	readonly serverName: string
	readonly toolName: string
	readonly source?: "client" | "mcp"
}

export type ChatEvent =
	| {
			type: "accepted"
			requestId: string
			duplicate?: boolean
			generationId: string
			userMessage: { id: string; createdAt: string }
			assistantMessage: { id: string; createdAt: string }
	  }
	| { type: "delta"; assistantMessageId: string; index: number; text: string }
	| { type: "part"; assistantMessageId: string; index: number; part: MessagePart }
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
			tools?: ClientToolManifest
			pageSession?: string
			resume?: boolean
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
	/** Roots belonging to a custom chat UI. They are excluded from page observation and actions. */
	pageControl?: { exclude?: readonly Element[]; themeRoot?: () => Element | null }
	/** AI SDK function tools with execute, runtime-validating schemas, static description, strict, and inputExamples. Other behaviors are rejected. */
	tools?: ToolSet
	apiUrl: string
	embedToken: string
	storage?: AsyncStorage
	transport?: ChatTransport
	randomUUID?: () => string
	now?: () => Date
	recoveryDelays?: ReadonlyArray<number>
}

export type ChatClient = {
	subscribe: (listener: () => void) => () => void
	getSnapshot: () => ChatSnapshot
	initialize: () => Promise<void>
	sendMessage: (text: string) => Promise<void>
	retryLastMessage: () => Promise<void>
	cancelResponse: () => Promise<void>
	startNewChat: () => Promise<void>
	dispose: () => void
}
