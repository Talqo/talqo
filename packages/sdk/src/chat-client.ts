import type {
	ChatClient,
	ChatClientOptions,
	ChatConfiguration,
	ChatError,
	ChatMessage,
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
		super(detail.code)
		this.name = "ChatClientError"
		this.detail = detail
	}
}

function defaultRandomUUID(): string {
	const crypto = globalThis.crypto
	if (crypto === undefined) throw new Error("Web Crypto is required to generate chat credentials")
	return crypto.randomUUID()
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(signal.reason)
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort)
			resolve()
		}, milliseconds)
		function onAbort() {
			clearTimeout(timeout)
			reject(signal.reason)
		}
		signal.addEventListener("abort", onAbort, { once: true })
	})
}

function transportError(error: unknown): ChatError {
	if (error instanceof ChatTransportError) return error.detail
	return {
		code: "transport-error",
	}
}

function isDefiniteClientError(error: unknown): error is ChatTransportError {
	if (!(error instanceof ChatTransportError)) return false
	const status = error.detail.status
	return status !== undefined && status >= HTTP_CLIENT_ERROR && status < HTTP_SERVER_ERROR
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
		() => {
			persistence = "memory"
			error = {
				code: "storage-unavailable",
			}
			publish()
		},
	)

	function createSnapshot(): ChatSnapshot {
		return {
			configuration,
			messages,
			initialization,
			generation,
			reset,
			persistence,
			recovery,
			error,
			retryAt,
		}
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
		messages = session.messages
		activeGenerationId = session.activeGeneration?.id
		error = undefined
		retryAt = undefined
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
				let attemptedPending: ChatStorageRecord["pending"]
				try {
					const delay = delays[Math.min(poll, delays.length - 1)] ?? FIVE_SECONDS_MS
					// oxlint-disable-next-line no-await-in-loop
					await wait(delay, controller.signal)
					if (credential === undefined) return
					if (pendingMessage !== undefined) {
						const pending = pendingMessage
						attemptedPending = pending
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
				} catch (cause) {
					if (controller.signal.aborted) return
					if (isDefiniteClientError(cause)) {
						if (attemptedPending !== undefined && pendingMessage?.requestId === attemptedPending.requestId) {
							const attemptedRequestId = attemptedPending.requestId
							pendingMessage = undefined
							messages = messages.filter((message) => message.id !== `pending:${attemptedRequestId}`)
							// oxlint-disable-next-line no-await-in-loop -- recovery attempts are intentionally sequential.
							await persist({ version: CHAT_STORAGE_VERSION, credential })
						}
						error = cause.detail
						retryAt = cause.detail.retryAt
						generation = "idle"
						recovery = "idle"
						activeGenerationId = undefined
						publish()
						return
					}
				}
			}
			if (!disposed && generation === "recovery") {
				recovery = "unavailable"
				messages = messages.map((message) =>
					message.outcome === "streaming" ? { ...message, outcome: "interrupted" as const } : message,
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
				configuration = loadedConfiguration
				const record = readChatStorageRecord(serialized)
				credential = record?.credential
				pendingMessage = record?.pending
				if (credential !== undefined && pendingMessage === undefined) {
					await acceptSession(await transport.loadSession({ ...context(controller.signal), credential }))
				} else if (pendingMessage !== undefined) {
					messages = [
						{
							id: `pending:${pendingMessage.requestId}`,
							role: "user",
							text: pendingMessage.text,
							createdAt: now().toISOString(),
							outcome: "interrupted",
						},
					]
					generation = "recovery"
					recovery = "pending"
				}
				initialization = "ready"
				publish()
				if (activeGenerationId !== undefined || pendingMessage !== undefined) beginSessionRecoveryPolling()
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
		messages = messages.map((message) => (message.id === id ? update(message) : message))
	}

	async function sendMessage(text: string): Promise<void> {
		requireUsable()
		if (initialization !== "ready") throw new Error("Chat client is not initialized")
		if (reset === "resetting") throw new Error("Chat session is resetting")
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
		messages = [
			...messages,
			{ id: localUserId, role: "user", text, createdAt: now().toISOString(), outcome: "pending" },
		]
		generation = "sending"
		recovery = "idle"
		error = undefined
		retryAt = undefined
		publish()
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
					activeGenerationId = event.generationId
					messages = messages.map((message) =>
						message.id === localUserId
							? { ...message, id: event.userMessage.id, createdAt: event.userMessage.createdAt, outcome: "completed" }
							: message,
					)
					assistantId = event.assistantMessage.id
					messages = [
						...messages,
						{
							id: assistantId,
							role: "assistant",
							text: "",
							createdAt: event.assistantMessage.createdAt,
							outcome: "streaming",
						},
					]
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
					if (assistantId !== undefined)
						replaceMessage(assistantId, (message) => ({ ...message, outcome: event.outcome }))
					if (event.type === "error") error = event.error
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
			const definitelyRejected = !accepted && isDefiniteClientError(cause)
			if (definitelyRejected) {
				messages = messages.filter((message) => message.id !== localUserId)
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
			} else if (!(cause instanceof ChatClientError)) {
				if (!accepted) replaceMessage(localUserId, (message) => ({ ...message, outcome: "interrupted" }))
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
				if (preAcceptance && pendingMessage !== undefined && credential !== undefined) {
					const requestId = pendingMessage.requestId
					pendingMessage = undefined
					replaceMessage(`pending:${requestId}`, (message) => ({ ...message, outcome: "interrupted" }))
					await persist({ version: CHAT_STORAGE_VERSION, credential })
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
				if (preAcceptance) {
					// The user already cancelled: recover by observation only, never resubmit the send.
					const cancelledPending = pendingMessage
					pendingMessage = undefined
					if (cancelledPending !== undefined) {
						replaceMessage(`pending:${cancelledPending.requestId}`, (message) => ({
							...message,
							outcome: "interrupted",
						}))
						if (credential !== undefined) await persist({ version: CHAT_STORAGE_VERSION, credential })
					}
					generation = "recovery"
					recovery = "pending"
					error = cause instanceof ChatTransportError ? cause.detail : { code: "cancel-failed" }
					beginSessionRecoveryPolling()
				} else if (generation === "cancelling") {
					// No concurrent transition settled: restore the pre-cancel state.
					generation = previousGeneration
					error = cause instanceof ChatTransportError ? cause.detail : { code: "cancel-failed" }
				}
				// A concurrent transition keeps its own state and error.
				publish()
				if (preAcceptance && cause instanceof ChatTransportError && cause.detail.status === HTTP_UNAUTHORIZED) return
				throw cause
			} finally {
				if (cancellationController === controller) cancellationController = undefined
				if (cancellationPromise === cancellation) cancellationPromise = undefined
			}
		})()
		cancellationPromise = cancellation
		return cancellation
	}

	async function retryLastMessage(): Promise<void> {
		requireUsable()
		if (error?.retriable !== true) throw new Error("The latest chat error is not retriable")
		const failedAssistantIndex = messages.length - 1
		const failedAssistant = messages[failedAssistantIndex]
		if (failedAssistant?.role !== "assistant" || failedAssistant.outcome !== "failed") {
			throw new Error("No failed response is available to retry")
		}
		const failedUserMessage = messages
			.slice(0, failedAssistantIndex)
			.findLast((message) => message.role === "user" && message.outcome === "completed")
		if (failedUserMessage === undefined) throw new Error("No failed message is available to retry")
		await sendMessage(failedUserMessage.text)
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
			messages = []
			generation = "idle"
			recovery = "idle"
			error = undefined
			retryAt = undefined
			if (configuration !== undefined) initialization = "ready"
		} catch (cause) {
			error = { ...transportError(cause), code: "reset-failed" }
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
		retryLastMessage,
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
