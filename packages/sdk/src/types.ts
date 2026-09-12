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

export type ChatError = {
	code: string
	message: string
	retryAt?: string
	retriable: boolean
	newChatAvailable: boolean
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

export type ServerMessage = ChatMessage

export type SessionState = {
	messages: readonly ServerMessage[]
	activeGeneration: { id: string } | undefined
}

export type BootstrapRecovery =
	| { status: "accepted"; credential: string }
	| { status: "not-accepted" }
	| { status: "unavailable" }

export type ChatEvent =
	| {
			type: "accepted"
			requestId: string
			credential?: string
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
	recoverBootstrap(input: TransportContext & { requestId: string; bootstrapSecret: string }): Promise<BootstrapRecovery>
	sendMessage(
		input: TransportContext & {
			text: string
			requestId: string
			credential?: string
			bootstrapSecret?: string
		},
	): Promise<AsyncIterable<ChatEvent>>
	cancelResponse(
		input: TransportContext & {
			credential?: string
			generationId?: string
			requestId?: string
			bootstrapSecret?: string
		},
	): Promise<void>
}

export type ChatClientOptions = {
	apiUrl: string
	embedToken: string
	storage?: AsyncStorage
	transport?: ChatTransport
	randomBytes?: (length: number) => Uint8Array
	now?: () => Date
	recoveryDelays?: readonly number[]
}

export type ChatClient = {
	subscribe(listener: () => void): () => void
	getSnapshot(): ChatSnapshot
	initialize(): Promise<void>
	sendMessage(text: string): Promise<void>
	cancelResponse(): Promise<void>
	startNewChat(): Promise<void>
	dispose(): void
}
