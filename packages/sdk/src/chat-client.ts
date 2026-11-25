import type {
	ActiveTool,
	ChatClient,
	ChatClientOptions,
	ChatConfiguration,
	ChatError,
	ChatEvent,
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

const ONE_SECOND_MS = 1000
const TWO_SECONDS_MS = 2000
const FIVE_SECONDS_MS = 5000
const DEFAULT_RECOVERY_DELAYS = [ONE_SECOND_MS, TWO_SECONDS_MS, FIVE_SECONDS_MS] as const
const MAX_RECOVERY_POLLS = 65
const HTTP_CLIENT_ERROR = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_SERVER_ERROR = 500
const NEW_CHAT_ERRORS = new Set(["chat-conversation-too-long", "chat-context-limit", "chat-session-unauthorized"])
type GenerationState = "idle" | "sending" | "streaming" | "recovery" | "recovery-exhausted" | "cancelling"
const GENERATION_ACTIVITIES: Record<Exclude<GenerationState, "idle" | "cancelling">, ChatSnapshot["activity"]> = {
	sending: "sending",
	streaming: "responding",
	recovery: "recovering",
	"recovery-exhausted": "blocked",
}

type ActiveSend = {
	controller: AbortController
	cancellationRequested: boolean
	dispatched: boolean
	newSession: boolean
	persisted: Promise<void>
}

type SendState = {
	send: ActiveSend
	credential: string
	requestId: string
	localUserId: string
	assistantId?: string
	terminalReceived: boolean
	accepted: boolean
}

type PendingRecoveryAttempt = {
	credential: string
	requestId: string
	text: string
}

type CancellationState = {
	controller: AbortController
	preAcceptance: boolean
	send: ActiveSend | undefined
	previousGeneration: GenerationState
}

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

function requireEventOrder(state: SendState, event: ChatEvent): void {
	if (!state.accepted && event.type !== "accepted") {
		throw new Error(`Chat stream emitted ${event.type} before acceptance`)
	}
	if (state.accepted && event.type === "accepted") throw new Error("Chat stream emitted acceptance more than once")
}

function shouldCancelRemote(state: CancellationState): boolean {
	return !state.preAcceptance || Boolean(state.send?.dispatched)
}

function cancellationError(cause: unknown): ChatError {
	return cause instanceof ChatTransportError ? cause.detail : { code: "cancel-failed" }
}

function isUnauthorizedCancellation(state: CancellationState, cause: unknown): boolean {
	return state.preAcceptance && cause instanceof ChatTransportError && cause.detail.status === HTTP_UNAUTHORIZED
}

export function createChatClient(options: ChatClientOptions): ChatClient {
	let configuration: ChatConfiguration | undefined
	let messages: ReadonlyArray<ChatMessage> = []
	let initialization: "loading" | "ready" | "error" = "loading"
	let generation: GenerationState = "idle"
	let resetting = false
	let acceptedMessageId: string | undefined
	let error: ChatError | undefined
	let credential: string | undefined
	let pendingMessage: ChatStorageRecord["pending"]
	let activeGenerationId: string | undefined
	let activeTools: Array<ActiveTool> = []
	let disposed = false
	let initializePromise: Promise<void> | undefined
	let activeSend: ActiveSend | undefined
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

	function newChatAvailable(): boolean {
		if (error === undefined) return false
		return error.newChatAvailable ?? NEW_CHAT_ERRORS.has(error.code)
	}

	function canSend(): boolean {
		return initialization === "ready" && generation === "idle" && !activeSend && !pendingMessage
	}

	function canRetry(): boolean {
		const lastMessage = messages.at(-1)
		return Boolean(error?.retriable && lastMessage?.role === "assistant" && lastMessage.outcome === "failed")
	}

	function idleActions(): Array<ChatSnapshot["actions"][number]> {
		const actions: Array<ChatSnapshot["actions"][number]> = []
		if (canSend()) {
			actions.push("send")
			if (canRetry()) actions.push("retry")
		}
		return actions
	}

	function canStartNewChat(availableAfterError: boolean): boolean {
		return initialization === "ready" || (initialization === "error" && availableAfterError)
	}

	function snapshotActions(isAvailable: boolean, availableAfterError: boolean): ChatSnapshot["actions"] {
		if (!isAvailable || resetting) return []
		const actions = idleActions()
		if (generation !== "idle" && generation !== "cancelling") actions.push("stop")
		if (canStartNewChat(availableAfterError)) actions.push("new-chat")
		return actions
	}

	function snapshotNotices(): ChatSnapshot["notices"] {
		const notices: Array<ChatSnapshot["notices"][number]> = []
		if (storage.isFallback() && error?.code !== "storage-unavailable") notices.push("storage-unavailable")
		if (generation === "recovery-exhausted") notices.push("recovery-unavailable")
		return notices
	}

	function createSnapshot(): ChatSnapshot {
		const isAvailable = configuration?.isAvailable === true
		const availableAfterError = newChatAvailable()
		return {
			isAvailable,
			configuration,
			activeTools,
			messages,
			activity: currentActivity(),
			actions: snapshotActions(isAvailable, availableAfterError),
			notices: snapshotNotices(),
			acceptedMessageId,
			error: error && { ...error, newChatAvailable: availableAfterError },
		}
	}

	function currentActivity(): ChatSnapshot["activity"] {
		if (resetting) return "resetting"
		if (generation === "cancelling") return "stopping"
		if (initialization === "error") return "blocked"
		if (generation === "idle") return initialization === "ready" ? "idle" : "loading"
		return GENERATION_ACTIVITIES[generation]
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

	async function replayPending(attempt: PendingRecoveryAttempt, signal: AbortSignal): Promise<void> {
		const events = await transport.sendMessage({
			...context(signal),
			credential: attempt.credential,
			requestId: attempt.requestId,
			text: attempt.text,
		})
		// Obtaining a successful response proves the idempotent request was accepted.
		const iterator = events[Symbol.asyncIterator]()
		if (typeof iterator.return === "function") await iterator.return()
		if (pendingMessage?.requestId === attempt.requestId) {
			pendingMessage = undefined
			await persist({ version: CHAT_STORAGE_VERSION, credential: attempt.credential })
		}
	}

	async function rejectRecoveryAttempt(attempt: PendingRecoveryAttempt | undefined, detail: ChatError): Promise<void> {
		if (attempt !== undefined && pendingMessage?.requestId === attempt.requestId) {
			pendingMessage = undefined
			messages = messages.filter((message) => message.id !== `pending:${attempt.requestId}`)
			await persist({ version: CHAT_STORAGE_VERSION, credential: attempt.credential })
		}
		error = detail
		generation = "idle"
		activeGenerationId = undefined
		publish()
	}

	async function recoverSession(controller: AbortController, delay: number): Promise<boolean> {
		let attempted: PendingRecoveryAttempt | undefined
		try {
			await wait(delay, controller.signal)
			if (credential === undefined) return true
			if (pendingMessage !== undefined) {
				attempted = { ...pendingMessage, credential }
				await replayPending(attempted, controller.signal)
			}
			const session = await transport.loadSession({ ...context(controller.signal), credential })
			applySession(session)
			return session.activeGeneration === undefined
		} catch (cause) {
			if (controller.signal.aborted) return true
			if (isDefiniteRejection(cause)) {
				await rejectRecoveryAttempt(attempted, cause.detail)
				return true
			}
			return false
		}
	}

	function exhaustRecovery(): void {
		if (!disposed && generation === "recovery") {
			generation = "recovery-exhausted"
			messages = messages.map((message) =>
				message.outcome === "streaming" ? { ...message, outcome: "interrupted" as const } : message,
			)
			publish()
		}
	}

	async function pollRecovery(controller: AbortController): Promise<void> {
		const delays = options.recoveryDelays ?? DEFAULT_RECOVERY_DELAYS
		const attempt = async (poll: number): Promise<boolean> => {
			if (poll === MAX_RECOVERY_POLLS) return false
			const delay = delays[Math.min(poll, delays.length - 1)] ?? FIVE_SECONDS_MS
			return (await recoverSession(controller, delay)) || attempt(poll + 1)
		}
		if (!(await attempt(0))) exhaustRecovery()
	}

	function beginSessionRecoveryPolling(): void {
		if (credential === undefined || disposed) return
		recoveryController?.abort()
		const controller = new AbortController()
		recoveryController = controller
		void pollRecovery(controller)
	}

	async function restoreStoredSession(serialized: string | null, signal: AbortSignal): Promise<void> {
		const record = readChatStorageRecord(serialized)
		credential = record?.credential
		pendingMessage = record?.pending
		if (credential !== undefined && pendingMessage === undefined) {
			applySession(await transport.loadSession({ ...context(signal), credential }))
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

	async function loadInitialState(controller: AbortController): Promise<void> {
		const [loadedConfiguration, serialized] = await Promise.all([
			transport.loadConfiguration(context(controller.signal)),
			storage.getItem(storageKey),
		])
		configuration = loadedConfiguration
		if (loadedConfiguration.isAvailable) await restoreStoredSession(serialized, controller.signal)
		initialization = "ready"
		publish()
		if (activeGenerationId !== undefined || pendingMessage !== undefined) beginSessionRecoveryPolling()
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
				await loadInitialState(controller)
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

	function requireReadyToSend(): void {
		requireUsable()
		if (initialization !== "ready") throw new Error("Chat client is not initialized")
		if (!snapshot.isAvailable) throw new ChatClientError({ code: "chat-unavailable" })
		if (resetting) throw new Error("Chat session is resetting")
	}

	function requireIdleSend(): void {
		if (activeSend !== undefined) throw new Error("A chat response is already active")
		if (pendingMessage !== undefined) {
			throw new Error("The pending message must be recovered before sending another message")
		}
		if (generation !== "idle") throw new Error("A chat response is already active")
	}

	function beginSend(text: string): SendState {
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
		return {
			send,
			credential: sendCredential,
			requestId,
			localUserId: `pending:${requestId}`,
			accepted: false,
			terminalReceived: false,
		}
	}

	async function acceptSend(state: SendState, event: Extract<ChatEvent, { type: "accepted" }>): Promise<void> {
		state.accepted = true
		acceptedMessageId = event.userMessage.id
		activeGenerationId = event.generationId
		messages = messages.map((message) =>
			message.id === state.localUserId
				? { ...message, id: event.userMessage.id, createdAt: event.userMessage.createdAt, outcome: "completed" }
				: message,
		)
		state.assistantId = event.assistantMessage.id
		messages = [
			...messages,
			{
				id: state.assistantId,
				role: "assistant",
				text: "",
				createdAt: event.assistantMessage.createdAt,
				outcome: "streaming",
			},
		]
		generation = "streaming"
		pendingMessage = undefined
		await persist({ version: CHAT_STORAGE_VERSION, credential: state.credential })
		publish()
	}

	function applyToolEvent(event: Extract<ChatEvent, { type: "tool-start" | "tool-end" }>): void {
		if (event.type === "tool-start") {
			const { serverName, toolName } = event
			if (!activeTools.some((tool) => tool.toolName === toolName && tool.serverName === serverName)) {
				activeTools.push({ serverName, toolName })
			}
		} else {
			activeTools = activeTools.filter(
				(tool) => tool.toolName !== event.toolName || tool.serverName !== event.serverName,
			)
		}
		publish()
	}

	function completeSend(state: SendState, event: Extract<ChatEvent, { type: "terminal" | "error" }>): void {
		state.terminalReceived = true
		if (state.assistantId !== undefined) {
			replaceMessage(state.assistantId, (message) => ({ ...message, outcome: event.outcome }))
		}
		if (event.type === "error") error = event.error
		generation = "idle"
		activeGenerationId = undefined
		publish()
		if (event.type === "error") throw new ChatClientError(event.error)
	}

	function applyActiveSendEvent(state: SendState, event: Exclude<ChatEvent, { type: "accepted" }>): void {
		switch (event.type) {
			case "delta":
				state.assistantId = event.assistantMessageId
				replaceMessage(state.assistantId, (message) => ({ ...message, text: message.text + event.text }))
				publish()
				return
			case "tool-start":
			case "tool-end":
				applyToolEvent(event)
				return
			case "terminal":
			case "error":
				completeSend(state, event)
		}
	}

	async function consumeSendEvents(state: SendState, events: AsyncIterable<ChatEvent>): Promise<void> {
		for await (const event of events) {
			if (disposed) return
			requireEventOrder(state, event)
			if (event.type === "accepted") await acceptSend(state, event)
			else applyActiveSendEvent(state, event)
		}
		if (!state.terminalReceived) throw new Error("Chat stream closed without a terminal event")
	}

	async function rejectPendingSend(state: SendState, cause: unknown): Promise<void> {
		messages = messages.filter((message) => message.id !== state.localUserId)
		pendingMessage = undefined
		if (state.send.newSession) {
			credential = undefined
			try {
				await storage.removeItem(storageKey)
			} catch {
				// The rejection remains definite even when its local record cannot be removed.
			}
		} else {
			await persist({ version: CHAT_STORAGE_VERSION, credential: state.credential })
		}
		generation = "idle"
		error = transportError(cause)
	}

	function recoverSend(state: SendState, cause: unknown): void {
		if (!state.accepted) replaceMessage(state.localUserId, (message) => ({ ...message, outcome: "interrupted" }))
		if (state.assistantId !== undefined) {
			replaceMessage(state.assistantId, (message) => ({ ...message, outcome: "interrupted" }))
		}
		generation = "recovery"
		error = transportError(cause)
		beginSessionRecoveryPolling()
	}

	function handleStreamFailure(state: SendState, cause: unknown): void {
		if (state.send.cancellationRequested) {
			if (state.assistantId !== undefined) {
				replaceMessage(state.assistantId, (message) => ({ ...message, outcome: "cancelled" }))
			}
		} else if (!(cause instanceof ChatClientError)) {
			recoverSend(state, cause)
		}
	}

	async function sendMessage(text: string): Promise<void> {
		requireReadyToSend()
		requireIdleSend()
		if (text.length === 0) throw new Error("Message text must not be empty")
		const state = beginSend(text)
		try {
			await state.send.persisted
			state.send.controller.signal.throwIfAborted()
			messages = [
				...messages,
				{ id: state.localUserId, role: "user", text, createdAt: now().toISOString(), outcome: "pending" },
			]
			error = undefined
			publish()
			state.send.dispatched = true
			const events = await transport.sendMessage({
				...context(state.send.controller.signal),
				text,
				requestId: state.requestId,
				credential: state.credential,
			})
			await consumeSendEvents(state, events)
		} catch (cause) {
			if (!state.accepted && isDefiniteRejection(cause)) await rejectPendingSend(state, cause)
			else handleStreamFailure(state, cause)
			publish()
			throw cause
		} finally {
			if (activeSend === state.send) activeSend = undefined
			publish()
		}
	}

	function discardCancelledRequest(send: ActiveSend | undefined, sessionCredential: string): Promise<void> {
		if (send?.newSession && !send.dispatched) {
			credential = undefined
			return storage.removeItem(storageKey)
		}
		return persist({ version: CHAT_STORAGE_VERSION, credential: sessionCredential })
	}

	function clearCancelledPending(state: CancellationState): Promise<void> | undefined {
		if (!state.preAcceptance || pendingMessage === undefined || credential === undefined) return undefined
		const requestId = pendingMessage.requestId
		pendingMessage = undefined
		replaceMessage(`pending:${requestId}`, (message) => ({ ...message, outcome: "interrupted" }))
		return discardCancelledRequest(state.send, credential)
	}

	function stopActiveWork(): void {
		if (activeSend !== undefined) {
			activeSend.cancellationRequested = true
			activeSend.controller.abort(new Error("Chat response cancelled"))
		}
		recoveryController?.abort()
		generation = "idle"
		activeGenerationId = undefined
		publish()
	}

	async function recoverCancelledPending(cause: unknown): Promise<void> {
		// The user already cancelled: recover by observation only, never resubmit the send.
		const cancelledPending = pendingMessage
		pendingMessage = undefined
		if (cancelledPending !== undefined) {
			replaceMessage(`pending:${cancelledPending.requestId}`, (message) => ({ ...message, outcome: "interrupted" }))
			if (credential !== undefined) await persist({ version: CHAT_STORAGE_VERSION, credential })
		}
		generation = "recovery"
		error = cancellationError(cause)
		beginSessionRecoveryPolling()
	}

	async function handleCancellationFailure(state: CancellationState, cause: unknown): Promise<void> {
		if (state.preAcceptance) {
			await recoverCancelledPending(cause)
		} else if (generation === "cancelling") {
			// No concurrent transition settled: restore the pre-cancel state.
			generation = state.previousGeneration
			error = cancellationError(cause)
		}
		// A concurrent transition keeps its own state and error.
		publish()
		if (isUnauthorizedCancellation(state, cause)) return
		throw cause
	}

	async function performCancellation(state: CancellationState): Promise<void> {
		try {
			await state.send?.persisted
			if (credential !== undefined && shouldCancelRemote(state)) {
				await transport.cancelResponse({
					...context(state.controller.signal),
					credential,
					...(activeGenerationId === undefined ? {} : { generationId: activeGenerationId }),
				})
			}
			const pending = clearCancelledPending(state)
			if (pending) await pending
			stopActiveWork()
		} catch (cause) {
			return handleCancellationFailure(state, cause)
		}
	}

	function cancelResponse(): Promise<void> {
		requireUsable()
		if (cancellationPromise !== undefined) return cancellationPromise
		if (generation === "idle") return Promise.resolve()
		const state: CancellationState = {
			previousGeneration: generation,
			controller: new AbortController(),
			preAcceptance: activeSend !== undefined && activeGenerationId === undefined,
			send: activeSend,
		}
		cancellationController = state.controller
		if (state.preAcceptance && activeSend !== undefined) {
			activeSend.cancellationRequested = true
			activeSend.controller.abort(new Error("Chat response cancelled"))
		}
		generation = "cancelling"
		publish()
		const cancellation = performCancellation(state).finally(() => {
			if (cancellationController === state.controller) cancellationController = undefined
			if (cancellationPromise === cancellation) cancellationPromise = undefined
		})
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

	async function removeSessionRecord(): Promise<void> {
		const wasFallback = storage.isFallback()
		await storage.removeItem(storageKey)
		if (!wasFallback && storage.isFallback()) throw new Error("Persistent chat credential could not be removed")
	}

	async function startNewChat(): Promise<void> {
		requireUsable()
		if (resetting) return
		resetting = true
		publish()
		try {
			if (generation !== "idle" || activeGenerationId !== undefined) await cancelResponse()
			await removeSessionRecord()
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
