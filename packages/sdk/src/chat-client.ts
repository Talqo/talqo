import type {
	ChatClient,
	ChatClientOptions,
	ChatConfiguration,
	ChatError,
	ChatMessage,
	ChatMessageOutcome,
	ChatSnapshot,
	SessionState,
} from "./types"

import { ChatTransportError, createFetchChatTransport } from "./fetch-transport"
import {
	CHAT_STORAGE_VERSION,
	createChatStorageKey,
	createMemoryStorage,
	createResilientStorage,
	readChatStorageRecord,
	type ChatStorageRecord,
} from "./storage"

const ONE_SECOND_MS = 1_000
const TWO_SECONDS_MS = 2_000
const FIVE_SECONDS_MS = 5_000
const DEFAULT_RECOVERY_DELAYS = [ONE_SECOND_MS, TWO_SECONDS_MS, FIVE_SECONDS_MS] as const
const MAX_RECOVERY_POLLS = 65
const HTTP_CLIENT_ERROR = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_SERVER_ERROR = 500

export class ChatClientError extends Error {
	readonly detail: ChatError

	constructor(detail: ChatError) {
		super(detail.message)
		this.name = "ChatClientError"
		this.detail = detail
	}
}

function defaultRandomUUID(): string {
	const crypto = globalThis.crypto
	if (crypto === undefined) throw new Error("Web Crypto is required to generate chat credentials")
	return crypto.randomUUID()
}

function freezeConfiguration(configuration: ChatConfiguration): ChatConfiguration {
	return Object.freeze({ ...configuration, appearance: Object.freeze({ ...configuration.appearance }) })
}

function freezeMessages(messages: readonly ChatMessage[]): readonly ChatMessage[] {
	return Object.freeze(messages.map((message) => Object.freeze({ ...message })))
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(resolve, milliseconds)
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout)
				reject(signal.reason)
			},
			{ once: true },
		)
	})
}

function transportError(error: unknown): ChatError {
	if (error instanceof ChatTransportError) return error.detail
	return {
		code: "transport_error",
		message: "The chat transport failed",
		retriable: true,
		newChatAvailable: false,
	}
}

export function createChatClient(options: ChatClientOptions): ChatClient {
	let configuration: ChatConfiguration | undefined
	let messages: readonly ChatMessage[] = []
	let initialization: ChatSnapshot["initialization"] = "idle"
	let generation: ChatSnapshot["generation"] = "idle"
	let reset: ChatSnapshot["reset"] = "idle"
	let persistence: ChatSnapshot["persistence"] = "persistent"
	let recovery: ChatSnapshot["recovery"] = "idle"
	let error: ChatError | undefined
	let retryAt: string | undefined
	let credential: string | undefined
	let pendingMessage: ChatStorageRecord["pending"]
	let activeGenerationId: string | undefined
	let disposed = false
	let initializePromise: Promise<void> | undefined
	let activeSend:
		| {
				controller: AbortController
				cancellationRequested: boolean
		  }
		| undefined
	let initializationController: AbortController | undefined
	let recoveryController: AbortController | undefined
	let cancellationController: AbortController | undefined
	let cancellationPromise: Promise<void> | undefined
	const listeners = new Set<() => void>()
	const storageKey = createChatStorageKey(options.apiUrl, options.embedToken)
	const randomUUID = options.randomUUID ?? defaultRandomUUID
	const now = options.now ?? (() => new Date())
	const transport = options.transport ?? createFetchChatTransport()

	let snapshot = createSnapshot()
	const storage = createResilientStorage(
		options.storage ?? {
			getItem: async (key) => globalThis.localStorage.getItem(key),
			setItem: async (key, value) => globalThis.localStorage.setItem(key, value),
			removeItem: async (key) => globalThis.localStorage.removeItem(key),
		},
		createMemoryStorage(),
		(storageError) => {
			persistence = "memory"
			error = {
				code: "storage_unavailable",
				message: storageError instanceof Error ? storageError.message : "Persistent storage is unavailable",
				retriable: false,
				newChatAvailable: false,
			}
			publish()
		},
	)

	function createSnapshot(): ChatSnapshot {
		return Object.freeze({
			configuration,
			messages,
			initialization,
			generation,
			reset,
			persistence,
			recovery,
			error,
			retryAt,
		})
	}

	function publish(): void {
		if (disposed) return
		snapshot = createSnapshot()
		for (const listener of listeners) listener()
	}

	function requireUsable(): void {
		if (disposed) throw new Error("Chat client is disposed")
	}

	function context(signal: AbortSignal) {
		return { apiUrl: options.apiUrl, embedToken: options.embedToken, signal }
	}

	async function persist(record: ChatStorageRecord): Promise<void> {
		await storage.setItem(storageKey, JSON.stringify(record))
	}

	function applySession(session: SessionState): void {
		messages = freezeMessages(session.messages)
		activeGenerationId = session.activeGeneration?.id
		if (session.activeGeneration === undefined) {
			generation = "idle"
			recovery = "idle"
		} else {
			generation = "recovery"
			recovery = "pending"
		}
		publish()
	}

	async function acceptSession(session: SessionState): Promise<void> {
		applySession(session)
		if (pendingMessage === undefined || credential === undefined) return
		pendingMessage = undefined
		await persist({ version: CHAT_STORAGE_VERSION, credential })
	}

	function beginSessionRecoveryPolling(): void {
		if (credential === undefined || disposed) return
		recoveryController?.abort()
		const controller = new AbortController()
		recoveryController = controller
		void (async () => {
			// Recovery delays are ordered backoff steps, so polling is intentionally sequential.
			const delays = options.recoveryDelays ?? DEFAULT_RECOVERY_DELAYS
			for (let poll = 0; poll < MAX_RECOVERY_POLLS; poll += 1) {
				try {
					const delay = delays[Math.min(poll, delays.length - 1)] ?? FIVE_SECONDS_MS
					// oxlint-disable-next-line no-await-in-loop
					await wait(delay, controller.signal)
					if (credential === undefined) return
					if (pendingMessage !== undefined) {
						const pending = pendingMessage
						// oxlint-disable-next-line no-await-in-loop
						const events = await transport.sendMessage({
							...context(controller.signal),
							credential,
							requestId: pending.requestId,
							text: pending.text,
						})
						// Obtaining a successful response proves the idempotent request was accepted.
						// oxlint-disable-next-line no-await-in-loop
						await events[Symbol.asyncIterator]().return?.()
						if (pendingMessage?.requestId === pending.requestId) {
							pendingMessage = undefined
							// oxlint-disable-next-line no-await-in-loop
							await persist({ version: CHAT_STORAGE_VERSION, credential })
						}
					}
					// oxlint-disable-next-line no-await-in-loop
					const session = await transport.loadSession({ ...context(controller.signal), credential })
					// oxlint-disable-next-line no-await-in-loop
					await acceptSession(session)
					if (session.activeGeneration === undefined) return
				} catch {
					if (controller.signal.aborted) return
				}
			}
			if (!disposed && generation === "recovery") {
				recovery = "unavailable"
				messages = freezeMessages(
					messages.map((message) =>
						message.outcome === "streaming" ? { ...message, outcome: "interrupted" as const } : message,
					),
				)
				publish()
			}
		})()
	}

	async function initialize(): Promise<void> {
		requireUsable()
		if (initialization === "ready") return
		if (initializePromise !== undefined) return initializePromise
		initializePromise = (async () => {
			initialization = "loading"
			publish()
			const controller = new AbortController()
			initializationController = controller
			try {
				const [loadedConfiguration, serialized] = await Promise.all([
					transport.loadConfiguration(context(controller.signal)),
					storage.getItem(storageKey),
				])
				configuration = freezeConfiguration(loadedConfiguration)
				const record = readChatStorageRecord(serialized)
				credential = record?.credential
				pendingMessage = record?.pending
				if (credential !== undefined && pendingMessage === undefined) {
					await acceptSession(await transport.loadSession({ ...context(controller.signal), credential }))
				} else if (pendingMessage !== undefined) {
					messages = freezeMessages([
						{
							id: `pending:${pendingMessage.requestId}`,
							role: "user",
							text: pendingMessage.text,
							createdAt: now().toISOString(),
							outcome: "interrupted",
						},
					])
					generation = "recovery"
					recovery = "pending"
				}
				initialization = "ready"
				publish()
				if (activeGenerationId !== undefined) beginSessionRecoveryPolling()
				else if (pendingMessage !== undefined) beginSessionRecoveryPolling()
			} catch (cause) {
				initialization = "error"
				error = transportError(cause)
				publish()
				throw cause
			} finally {
				if (initializationController === controller) initializationController = undefined
			}
		})()
		try {
			await initializePromise
		} finally {
			initializePromise = undefined
		}
	}

	function replaceMessage(id: string, update: (message: ChatMessage) => ChatMessage): void {
		messages = freezeMessages(messages.map((message) => (message.id === id ? update(message) : message)))
	}

	async function sendMessage(text: string): Promise<void> {
		requireUsable()
		if (initialization !== "ready") throw new Error("Chat client is not initialized")
		if (activeSend !== undefined) throw new Error("A chat response is already active")
		if (pendingMessage !== undefined) {
			throw new Error("The pending message must be recovered before sending another message")
		}
		if (generation !== "idle") throw new Error("A chat response is already active")
		if (text.length === 0) throw new Error("Message text must not be empty")
		const newSession = credential === undefined
		credential ??= randomUUID()
		const sendCredential = credential
		const requestId = randomUUID()
		const controller = new AbortController()
		const send = { controller, cancellationRequested: false }
		activeSend = send
		pendingMessage = { requestId, text }
		await persist({ version: CHAT_STORAGE_VERSION, credential: sendCredential, pending: pendingMessage })
		const localUserId = `pending:${requestId}`
		messages = freezeMessages([
			...messages,
			{ id: localUserId, role: "user", text, createdAt: now().toISOString(), outcome: "pending" },
		])
		generation = "sending"
		recovery = "idle"
		error = undefined
		retryAt = undefined
		publish()
		let userId = localUserId
		let assistantId: string | undefined
		let terminalReceived = false
		let accepted = false
		try {
			const events = await transport.sendMessage({
				...context(controller.signal),
				text,
				requestId,
				credential: sendCredential,
			})
			for await (const event of events) {
				if (disposed) return
				if (!accepted && event.type !== "accepted") {
					throw new Error(`Chat stream emitted ${event.type} before acceptance`)
				}
				if (accepted && event.type === "accepted") throw new Error("Chat stream emitted acceptance more than once")
				if (event.type === "accepted") {
					accepted = true
					userId = event.userMessage.id
					activeGenerationId = event.generationId
					messages = freezeMessages(
						messages.map((message) =>
							message.id === localUserId
								? { ...message, id: userId, createdAt: event.userMessage.createdAt, outcome: "completed" }
								: message,
						),
					)
					assistantId = event.assistantMessage.id
					messages = freezeMessages([
						...messages,
						{
							id: assistantId,
							role: "assistant",
							text: "",
							createdAt: event.assistantMessage.createdAt,
							outcome: "streaming",
						},
					])
					generation = "streaming"
					pendingMessage = undefined
					await persist({ version: CHAT_STORAGE_VERSION, credential: sendCredential })
					publish()
				} else if (event.type === "delta") {
					assistantId = event.assistantMessageId
					replaceMessage(assistantId, (message) => ({ ...message, text: message.text + event.text }))
					publish()
				} else {
					terminalReceived = true
					const outcome: ChatMessageOutcome = event.outcome
					if (assistantId !== undefined) replaceMessage(assistantId, (message) => ({ ...message, outcome }))
					if (event.type === "error") error = event.error
					if (event.type === "terminal" && event.error !== undefined) error = event.error
					retryAt = error?.retryAt
					generation = "idle"
					recovery = "idle"
					activeGenerationId = undefined
					publish()
					if (event.type === "error") throw new ChatClientError(event.error)
				}
			}
			if (!terminalReceived) throw new Error("Chat stream closed without a terminal event")
		} catch (cause) {
			const status = cause instanceof ChatTransportError ? cause.detail.status : undefined
			const definitelyRejected =
				!accepted && status !== undefined && status >= HTTP_CLIENT_ERROR && status < HTTP_SERVER_ERROR
			if (definitelyRejected) {
				messages = freezeMessages(messages.filter((message) => message.id !== localUserId))
				pendingMessage = undefined
				if (newSession) {
					credential = undefined
					try {
						await storage.removeItem(storageKey)
					} catch {
						// The rejection remains definite even when its local record cannot be removed.
					}
				} else {
					await persist({ version: CHAT_STORAGE_VERSION, credential: sendCredential })
				}
				generation = "idle"
				recovery = "idle"
				error = transportError(cause)
				retryAt = error.retryAt
			} else if (send.cancellationRequested) {
				if (assistantId !== undefined) replaceMessage(assistantId, (message) => ({ ...message, outcome: "cancelled" }))
				generation = "idle"
				recovery = "idle"
			} else if (!(cause instanceof ChatClientError)) {
				replaceMessage(userId, (message) => ({ ...message, outcome: "interrupted" }))
				if (assistantId !== undefined)
					replaceMessage(assistantId, (message) => ({ ...message, outcome: "interrupted" }))
				generation = "recovery"
				recovery = "pending"
				error = transportError(cause)
				retryAt = error.retryAt
				beginSessionRecoveryPolling()
			}
			publish()
			throw cause
		} finally {
			if (activeSend === send) activeSend = undefined
		}
	}

	function cancelResponse(): Promise<void> {
		requireUsable()
		if (cancellationPromise !== undefined) return cancellationPromise
		if (generation === "idle") return Promise.resolve()
		const previousGeneration = generation
		const controller = new AbortController()
		cancellationController = controller
		const preAcceptance = activeSend !== undefined && activeGenerationId === undefined
		if (preAcceptance && activeSend !== undefined) {
			activeSend.cancellationRequested = true
			activeSend.controller.abort(new Error("Chat response cancelled"))
		}
		generation = "cancelling"
		publish()
		let cancellation!: Promise<void>
		cancellation = (async () => {
			try {
				if (credential !== undefined) {
					await transport.cancelResponse({
						...context(controller.signal),
						credential,
						...(activeGenerationId === undefined ? {} : { generationId: activeGenerationId }),
					})
				}
				if (activeSend !== undefined) {
					activeSend.cancellationRequested = true
					activeSend.controller.abort(new Error("Chat response cancelled"))
				}
				recoveryController?.abort()
				generation = "idle"
				recovery = "idle"
				activeGenerationId = undefined
				publish()
			} catch (cause) {
				if (preAcceptance && cause instanceof ChatTransportError && cause.detail.status === HTTP_UNAUTHORIZED) {
					recoveryController?.abort()
					generation = "idle"
					recovery = "idle"
					activeGenerationId = undefined
					publish()
					return
				}
				generation = previousGeneration
				error = { ...transportError(cause), code: "cancel_failed" }
				publish()
				throw cause
			} finally {
				if (cancellationController === controller) cancellationController = undefined
				if (cancellationPromise === cancellation) cancellationPromise = undefined
			}
		})()
		cancellationPromise = cancellation
		return cancellation
	}

	async function startNewChat(): Promise<void> {
		requireUsable()
		if (reset === "resetting") return
		reset = "resetting"
		publish()
		try {
			if (generation !== "idle" || activeGenerationId !== undefined) await cancelResponse()
			const wasFallback = storage.isFallback()
			await storage.removeItem(storageKey)
			if (!wasFallback && storage.isFallback()) {
				throw new Error("Persistent chat credential could not be removed")
			}
			recoveryController?.abort()
			credential = undefined
			pendingMessage = undefined
			activeGenerationId = undefined
			messages = freezeMessages([])
			generation = "idle"
			recovery = "idle"
			error = undefined
			retryAt = undefined
			if (configuration !== undefined) initialization = "ready"
		} catch (cause) {
			error = { ...transportError(cause), code: "reset_failed" }
			throw cause
		} finally {
			reset = "idle"
			publish()
		}
	}

	return {
		subscribe(listener) {
			requireUsable()
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		getSnapshot: () => snapshot,
		initialize,
		sendMessage,
		cancelResponse,
		startNewChat,
		dispose() {
			if (disposed) return
			disposed = true
			initializationController?.abort(new Error("Chat client disposed"))
			activeSend?.controller.abort(new Error("Chat client disposed"))
			cancellationController?.abort(new Error("Chat client disposed"))
			recoveryController?.abort()
			listeners.clear()
		},
	}
}
