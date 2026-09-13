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
	createLazyLocalStorage,
	createMemoryStorage,
	createResilientStorage,
	readChatStorageRecord,
	type ChatStorageRecord,
} from "./storage"

const ONE_SECOND_MS = 1_000
const TWO_SECONDS_MS = 2_000
const FIVE_SECONDS_MS = 5_000
const DEFAULT_RECOVERY_DELAYS = [ONE_SECOND_MS, TWO_SECONDS_MS, FIVE_SECONDS_MS] as const
const REQUEST_ID_BYTES = 16
const BOOTSTRAP_SECRET_BYTES = 32
const MAX_RECOVERY_POLLS = 25
const HTTP_CLIENT_ERROR = 400
const HTTP_SERVER_ERROR = 500
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
const BASE64_BYTE_GROUP_SIZE = 3
const BASE64_FIRST_SHIFT = 2
const BASE64_SECOND_SHIFT = 4
const BASE64_THIRD_SHIFT = 6
const BASE64_LOW_TWO_BITS = 3
const BASE64_LOW_FOUR_BITS = 15
const BASE64_LOW_SIX_BITS = 63
const SECOND_BYTE_OFFSET = 1
const THIRD_BYTE_OFFSET = 2

export class ChatClientError extends Error {
	readonly detail: ChatError

	constructor(detail: ChatError) {
		super(detail.message)
		this.name = "ChatClientError"
		this.detail = detail
	}
}

function defaultRandomBytes(length: number): Uint8Array {
	const crypto = globalThis.crypto
	if (crypto === undefined) throw new Error("Web Crypto is required to generate chat credentials")
	return crypto.getRandomValues(new Uint8Array(length))
}

function encodeBase64Url(bytes: Uint8Array): string {
	let encoded = ""
	for (let index = 0; index < bytes.length; index += BASE64_BYTE_GROUP_SIZE) {
		const first = bytes[index] ?? 0
		const second = bytes[index + SECOND_BYTE_OFFSET]
		const third = bytes[index + THIRD_BYTE_OFFSET]
		encoded += BASE64_ALPHABET[first >> BASE64_FIRST_SHIFT]
		encoded +=
			BASE64_ALPHABET[((first & BASE64_LOW_TWO_BITS) << BASE64_SECOND_SHIFT) | ((second ?? 0) >> BASE64_SECOND_SHIFT)]
		if (second !== undefined) {
			encoded +=
				BASE64_ALPHABET[((second & BASE64_LOW_FOUR_BITS) << BASE64_FIRST_SHIFT) | ((third ?? 0) >> BASE64_THIRD_SHIFT)]
		}
		if (third !== undefined) encoded += BASE64_ALPHABET[third & BASE64_LOW_SIX_BITS]
	}
	return encoded
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
	let pendingBootstrap: ChatStorageRecord["pending"]
	let activeGenerationId: string | undefined
	let disposed = false
	let initializePromise: Promise<void> | undefined
	let activeSend:
		| {
				controller: AbortController
				cancellationRequested: boolean
				requestId: string
				bootstrapSecret: string | undefined
		  }
		| undefined
	let initializationController: AbortController | undefined
	let recoveryController: AbortController | undefined
	let cancellationController: AbortController | undefined
	let cancellationPromise: Promise<void> | undefined
	const listeners = new Set<() => void>()
	const storageKey = createChatStorageKey(options.apiUrl, options.embedToken)
	const randomBytes = options.randomBytes ?? defaultRandomBytes
	const now = options.now ?? (() => new Date())
	const transport = options.transport ?? createFetchChatTransport()

	let snapshot = createSnapshot()
	const storage = createResilientStorage(
		options.storage ?? createLazyLocalStorage(),
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
					// oxlint-disable-next-line no-await-in-loop
					const session = await transport.loadSession({ ...context(controller.signal), credential })
					applySession(session)
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

	async function acceptRecoveredBootstrap(recoveredCredential: string, controller: AbortController): Promise<void> {
		await persist({ version: CHAT_STORAGE_VERSION, credential: recoveredCredential })
		credential = recoveredCredential
		pendingBootstrap = undefined
		try {
			applySession(await transport.loadSession({ ...context(controller.signal), credential }))
			if (activeGenerationId !== undefined) beginSessionRecoveryPolling()
		} catch (cause) {
			if (controller.signal.aborted) throw cause
			generation = "recovery"
			recovery = "pending"
			publish()
			beginSessionRecoveryPolling()
		}
	}

	function beginBootstrapRecoveryPolling(completedPolls = 0): void {
		if (credential !== undefined || pendingBootstrap === undefined || disposed) return
		recoveryController?.abort()
		const controller = new AbortController()
		recoveryController = controller
		generation = "recovery"
		recovery = "pending"
		publish()
		void (async () => {
			const delays = options.recoveryDelays ?? DEFAULT_RECOVERY_DELAYS
			for (let poll = completedPolls; poll < MAX_RECOVERY_POLLS; poll += 1) {
				try {
					const delay = delays[Math.min(poll, delays.length - 1)] ?? FIVE_SECONDS_MS
					// oxlint-disable-next-line no-await-in-loop -- recovery probes must remain bounded and sequential.
					await wait(delay, controller.signal)
					if (pendingBootstrap === undefined || credential !== undefined) return
					// oxlint-disable-next-line no-await-in-loop -- recovery probes must remain bounded and sequential.
					const result = await transport.recoverBootstrap({
						...context(controller.signal),
						requestId: pendingBootstrap.requestId,
						bootstrapSecret: pendingBootstrap.bootstrapSecret,
					})
					if (result.status === "accepted") {
						// oxlint-disable-next-line no-await-in-loop -- acceptance transitions into the single session recovery path.
						await acceptRecoveredBootstrap(result.credential, controller)
						return
					}
					if (result.status === "unavailable") break
				} catch {
					if (controller.signal.aborted) return
				}
			}
			if (!disposed && pendingBootstrap !== undefined && credential === undefined) {
				recovery = "unavailable"
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
				let recoveredBootstrap = false
				const [loadedConfiguration, serialized] = await Promise.all([
					transport.loadConfiguration(context(controller.signal)),
					storage.getItem(storageKey),
				])
				configuration = freezeConfiguration(loadedConfiguration)
				const record = readChatStorageRecord(serialized)
				credential = record?.credential
				pendingBootstrap = record?.pending
				if (credential === undefined && record?.pending !== undefined) {
					recovery = "pending"
					publish()
					const result = await transport.recoverBootstrap({
						...context(controller.signal),
						requestId: record.pending.requestId,
						bootstrapSecret: record.pending.bootstrapSecret,
					})
					if (result.status === "accepted") {
						await acceptRecoveredBootstrap(result.credential, controller)
						recoveredBootstrap = true
					} else if (result.status === "unavailable") {
						recovery = "unavailable"
					}
				}
				if (credential !== undefined && !recoveredBootstrap) {
					applySession(await transport.loadSession({ ...context(controller.signal), credential }))
				}
				initialization = "ready"
				publish()
				if (activeGenerationId !== undefined) beginSessionRecoveryPolling()
				else if (pendingBootstrap !== undefined && recovery !== "unavailable") beginBootstrapRecoveryPolling(1)
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
		if (credential === undefined && pendingBootstrap !== undefined) {
			throw new Error("The pending first message must be recovered before sending another message")
		}
		if (generation !== "idle") throw new Error("A chat response is already active")
		if (text.length === 0) throw new Error("Message text must not be empty")
		const requestId = pendingBootstrap?.requestId ?? encodeBase64Url(randomBytes(REQUEST_ID_BYTES))
		const bootstrapSecret =
			credential === undefined
				? (pendingBootstrap?.bootstrapSecret ?? encodeBase64Url(randomBytes(BOOTSTRAP_SECRET_BYTES)))
				: undefined
		const controller = new AbortController()
		const send = { controller, cancellationRequested: false, requestId, bootstrapSecret }
		activeSend = send
		if (bootstrapSecret !== undefined) {
			pendingBootstrap = { requestId, bootstrapSecret, text }
			await persist({ version: CHAT_STORAGE_VERSION, pending: pendingBootstrap })
		}
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
				...(credential === undefined ? {} : { credential }),
				...(bootstrapSecret === undefined ? {} : { bootstrapSecret }),
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
					if (event.credential !== undefined) {
						credential = event.credential
						pendingBootstrap = undefined
						await persist({ version: CHAT_STORAGE_VERSION, credential })
					}
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
				if (bootstrapSecret !== undefined) {
					pendingBootstrap = undefined
					try {
						await storage.removeItem(storageKey)
					} catch {
						// The rejection remains definite even when its bootstrap record cannot be removed.
					}
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
				if (credential !== undefined) beginSessionRecoveryPolling()
				else if (pendingBootstrap !== undefined) beginBootstrapRecoveryPolling()
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
		generation = "cancelling"
		publish()
		let cancellation!: Promise<void>
		cancellation = (async () => {
			try {
				if (credential !== undefined || activeSend?.bootstrapSecret !== undefined) {
					await transport.cancelResponse({
						...context(controller.signal),
						...(credential === undefined ? {} : { credential }),
						...(activeGenerationId === undefined ? {} : { generationId: activeGenerationId }),
						...(activeSend?.bootstrapSecret === undefined
							? {}
							: { requestId: activeSend.requestId, bootstrapSecret: activeSend.bootstrapSecret }),
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
			pendingBootstrap = undefined
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
