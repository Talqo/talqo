import type {
	ActiveTool,
	ChatClient,
	ChatClientOptions,
	ChatConfiguration,
	ChatError,
	ChatMessage,
	ChatSnapshot,
	SessionState,
} from "./types.ts"

import { ChatTransportError, createFetchChatTransport } from "./fetch-transport.ts"
import {
	CHAT_STORAGE_VERSION,
	type ChatStorageRecord,
	createChatStorageKey,
	createMemoryStorage,
	createResilientStorage,
	readChatStorageRecord,
} from "./storage.ts"

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
	try {
		return globalThis.crypto.randomUUID()
	} catch {
		throw new Error("Web Crypto is required to generate chat credentials")
	}
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason)
			return
		}
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

function isDefiniteRejection(error: unknown): error is ChatTransportError {
	if (!(error instanceof ChatTransportError)) return false
	const status = error.detail.status
	if (status === undefined) return false
	// The API rejects with provider-error only before acceptance; later provider failures arrive as stream events.
	return (status >= HTTP_CLIENT_ERROR && status < HTTP_SERVER_ERROR) || error.detail.code === "provider-error"
}

export function createChatClient(options: ChatClientOptions): ChatClient {
	let configuration: ChatConfiguration | undefined
	let messages: readonly ChatMessage[] = []
	let initialization: "loading" | "ready" | "error" = "loading"
	let generation: "idle" | "sending" | "streaming" | "recovery" | "recovery-exhausted" | "cancelling" = "idle"
	let resetting = false
	let acceptedMessageId: string | undefined
	let error: ChatError | undefined
	let credential: string | undefined
	let pendingMessage: ChatStorageRecord["pending"]
	let activeGenerationId: string | undefined
	let activeTools: ActiveTool[] = []
	let disposed = false
	let initializePromise: Promise<void> | undefined
	let activeSend:
		| {
				controller: AbortController
				cancellationRequested: boolean
				dispatched: boolean
				newSession: boolean
				persisted: Promise<void>
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

	const storage = createResilientStorage(
		options.storage ?? {
			getItem: async (key) => globalThis.localStorage.getItem(key),
			setItem: async (key, value) => {
				globalThis.localStorage.setItem(key, value)
			},
			removeItem: async (key) => {
				globalThis.localStorage.removeItem(key)
			},
		},
		createMemoryStorage(),
		() => {
			error = {
				code: "storage-unavailable",
			}
			publish()
		},
	)
	let snapshot = createSnapshot()

	function createSnapshot(): ChatSnapshot {
		const isAvailable = configuration?.isAvailable === true
		const newChatAvailable =
			error?.newChatAvailable ??
			(error?.code === "chat-conversation-too-long" ||
				error?.code === "chat-context-limit" ||
				error?.code === "chat-session-unauthorized")
		const actions: ChatSnapshot["actions"][number][] = []
		if (isAvailable && !resetting) {
			if (initialization === "ready" && generation === "idle" && !activeSend && !pendingMessage) {
				actions.push("send")
				if (error?.retriable && messages.at(-1)?.role === "assistant" && messages.at(-1)?.outcome === "failed")
					actions.push("retry")
			}
			if (generation !== "idle" && generation !== "cancelling") actions.push("stop")
			if (initialization === "ready" || (initialization === "error" && newChatAvailable)) actions.push("new-chat")
		}
		const notices: ChatSnapshot["notices"][number][] = []
		if (storage.isFallback() && error?.code !== "storage-unavailable") notices.push("storage-unavailable")
		if (generation === "recovery-exhausted") notices.push("recovery-unavailable")
		return {
			isAvailable,
			configuration,
			activeTools,
			messages,
			activity: currentActivity(),
			actions,
			notices,
			acceptedMessageId,
			error: error && { ...error, newChatAvailable },
		}
	}

	function currentActivity(): ChatSnapshot["activity"] {
		if (resetting) return "resetting"
		if (generation === "cancelling") return "stopping"
		if (generation === "recovery-exhausted" || initialization === "error") return "blocked"
		if (generation === "recovery") return "recovering"
		if (generation === "sending") return "sending"
		if (generation === "streaming") return "responding"
		return initialization === "ready" ? "idle" : "loading"
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
		acceptedMessageId = messages.findLast((message) => message.role === "user" && message.outcome === "completed")?.id
		activeGenerationId = session.activeGeneration?.id
		error = undefined
		generation = session.activeGeneration === undefined ? "idle" : "recovery"
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
						const iterator = events[Symbol.asyncIterator]()
						// oxlint-disable-next-line no-await-in-loop
						if (typeof iterator.return === "function") await iterator.return()
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
					if (isDefiniteRejection(cause)) {
						if (attemptedPending !== undefined && pendingMessage?.requestId === attemptedPending.requestId) {
							const attemptedRequestId = attemptedPending.requestId
							pendingMessage = undefined
							messages = messages.filter((message) => message.id !== `pending:${attemptedRequestId}`)
							// oxlint-disable-next-line no-await-in-loop -- recovery attempts are intentionally sequential.
							await persist({ version: CHAT_STORAGE_VERSION, credential })
						}
						error = cause.detail
						generation = "idle"
						activeGenerationId = undefined
						publish()
						return
					}
				}
			}
			if (!disposed && generation === "recovery") {
				generation = "recovery-exhausted"
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
				if (loadedConfiguration.isAvailable) {
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
					}
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
		if (!snapshot.isAvailable) throw new ChatClientError({ code: "chat-unavailable" })
		if (resetting) throw new Error("Chat session is resetting")
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
		pendingMessage = { requestId, text }
		generation = "sending"
		const record: ChatStorageRecord = {
			version: CHAT_STORAGE_VERSION,
			credential: sendCredential,
			pending: pendingMessage,
		}
		// Storage fallback callbacks must observe the assigned activeSend.
		const send = {
			controller,
			cancellationRequested: false,
			dispatched: false,
			newSession,
			persisted: Promise.resolve().then(() => persist(record)),
		}
		activeSend = send
		publish()
		const localUserId = `pending:${requestId}`
		let assistantId: string | undefined
		let terminalReceived = false
		let accepted = false
		try {
			await send.persisted
			controller.signal.throwIfAborted()
			messages = [
				...messages,
				{ id: localUserId, role: "user", text, createdAt: now().toISOString(), outcome: "pending" },
			]
			error = undefined
			publish()
			send.dispatched = true
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
					acceptedMessageId = event.userMessage.id
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
				} else if (event.type === "tool-start") {
					const { serverName, toolName } = event
					if (!activeTools.some((tool) => tool.toolName === toolName && tool.serverName === serverName))
						activeTools.push({ serverName, toolName })
					publish()
				} else if (event.type === "tool-end") {
					activeTools = activeTools.filter((t) => t.toolName !== event.toolName || t.serverName !== event.serverName)
					publish()
				} else {
					terminalReceived = true
					if (assistantId !== undefined)
						replaceMessage(assistantId, (message) => ({ ...message, outcome: event.outcome }))
					if (event.type === "error") error = event.error
					generation = "idle"
					activeGenerationId = undefined
					publish()
					if (event.type === "error") throw new ChatClientError(event.error)
				}
			}
			if (!terminalReceived) throw new Error("Chat stream closed without a terminal event")
		} catch (cause) {
			const definitelyRejected = !accepted && isDefiniteRejection(cause)
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
				error = transportError(cause)
			} else if (send.cancellationRequested) {
				if (assistantId !== undefined) replaceMessage(assistantId, (message) => ({ ...message, outcome: "cancelled" }))
			} else if (!(cause instanceof ChatClientError)) {
				if (!accepted) replaceMessage(localUserId, (message) => ({ ...message, outcome: "interrupted" }))
				if (assistantId !== undefined)
					replaceMessage(assistantId, (message) => ({ ...message, outcome: "interrupted" }))
				generation = "recovery"
				error = transportError(cause)
				beginSessionRecoveryPolling()
			}
			publish()
			throw cause
		} finally {
			if (activeSend === send) activeSend = undefined
			publish()
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
		const send = activeSend
		if (preAcceptance && activeSend !== undefined) {
			activeSend.cancellationRequested = true
			activeSend.controller.abort(new Error("Chat response cancelled"))
		}
		generation = "cancelling"
		publish()
		let cancellation!: Promise<void>
		cancellation = (async () => {
			try {
				await send?.persisted
				if (credential !== undefined && (!preAcceptance || send?.dispatched)) {
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
					if (send?.newSession && !send.dispatched) {
						credential = undefined
						await storage.removeItem(storageKey)
					} else {
						await persist({ version: CHAT_STORAGE_VERSION, credential })
					}
				}
				if (activeSend !== undefined) {
					activeSend.cancellationRequested = true
					activeSend.controller.abort(new Error("Chat response cancelled"))
				}
				recoveryController?.abort()
				generation = "idle"
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
		if (resetting) return
		resetting = true
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
			acceptedMessageId = undefined
			generation = "idle"
			error = undefined
			if (configuration !== undefined) initialization = "ready"
		} catch (cause) {
			error = { ...transportError(cause), code: "reset-failed" }
			throw cause
		} finally {
			resetting = false
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
