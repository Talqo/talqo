import type {
	ChatClient,
	ChatClientOptions,
	ChatConfiguration,
	ChatError,
	ChatEvent,
	ChatMessage,
	ChatSnapshot,
	SessionState,
} from "./types.ts"

import { captureClientTools, CLIENT_TOOL_LIMIT } from "./client-tools.ts"
import { ChatTransportError } from "./http-client.ts"
import { createPageTool, PAGE_TOOL_NAME } from "./page-tool/page-tool.ts"
import {
	CHAT_STORAGE_VERSION,
	type ChatStorageRecord,
	createChatStorageKey,
	createMemoryStorage,
	createResilientStorage,
	readChatStorageRecord,
} from "./storage.ts"
import {
	canStorePageContinuation,
	createWebSocketChatTransport,
	type PageContinuation,
	readPageContinuation,
	removePageContinuation,
} from "./websocket-transport.ts"

const ONE_SECOND_MS = 1_000
const TWO_SECONDS_MS = 2_000
const FIVE_SECONDS_MS = 5_000
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
	// A definite send rejection settles before a cancellation failure is handled.
	rejected: boolean
}

type SendState = {
	send: ActiveSend
	credential: string
	requestId: string
	localUserId: string
	assistantId?: string
	terminalReceived: boolean
	accepted: boolean
	pageSession?: string
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

function hasClientToolAction(message: ChatMessage | undefined): boolean {
	return message?.parts.some((part) => part.type === "dynamic-tool" && part.toolMetadata.source === "client") === true
}

function hasUncertainWebsiteAction(message: ChatMessage | undefined): boolean {
	if (message?.role !== "assistant") return false
	if (message.outcome === "completed" || message.outcome === "streaming") return false
	return message.parts.some(
		(part) =>
			part.type === "dynamic-tool" &&
			part.toolMetadata.source === "client" &&
			(part.state === "input-available" ||
				part.toolMetadata.outcome === "interrupted" ||
				part.toolMetadata.outcome === "cancelled"),
	)
}

function sendWasDefinitelyRejected(state: SendState, cause: unknown): boolean {
	if (state.accepted) return false
	return isDefiniteRejection(cause) || (!state.send.dispatched && !state.send.cancellationRequested)
}

function withOutcome(message: ChatMessage, outcome: ChatMessage["outcome"]): ChatMessage {
	const toolOutcome = outcome === "cancelled" || outcome === "interrupted" ? outcome : "failed"
	return {
		...message,
		outcome,
		parts: message.parts.map((part) =>
			part.type === "dynamic-tool" && part.state === "input-available"
				? {
						...part,
						state: "output-error",
						errorText: "Tool execution did not finish",
						toolMetadata: { ...part.toolMetadata, outcome: toolOutcome },
					}
				: part,
		),
	}
}

function pageLanguage(configuration: ChatConfiguration): string {
	return typeof configuration.appearance.language === "string" ? configuration.appearance.language : "en"
}

function cloneCustomTools(tools: ChatClientOptions["tools"]): NonNullable<ChatClientOptions["tools"]> {
	return Object.fromEntries(Object.entries(tools ?? {}).map(([name, definition]) => [name, { ...definition }]))
}

export function createChatClient(options: ChatClientOptions): ChatClient {
	let configuration: ChatConfiguration | undefined
	let messages: readonly ChatMessage[] = []
	let initialization: "loading" | "ready" | "error" = "loading"
	let generation: GenerationState = "idle"
	let resetting = false
	let acceptedMessageId: string | undefined
	let error: ChatError | undefined
	let credential: string | undefined
	let pendingMessage: ChatStorageRecord["pending"]
	let activeGenerationId: string | undefined
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
	const customTools = cloneCustomTools(options.tools)
	let tools = captureClientTools(customTools)
	let pageTool: ReturnType<typeof createPageTool> | undefined
	let pageStorageUnavailable = false
	if (options.transport && tools.size) throw new Error("Client tools require the WebSocket transport")
	const transport =
		options.transport ??
		createWebSocketChatTransport({
			manifest: () => tools.manifest(),
			execute: (request, signal) => tools.execute(request, signal),
		})

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
		if (hasClientToolAction(lastMessage)) return false
		return Boolean(error?.retriable && lastMessage?.role === "assistant" && lastMessage.outcome === "failed")
	}

	function idleActions(): ChatSnapshot["actions"][number][] {
		const actions: ChatSnapshot["actions"][number][] = []
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
		const notices: ChatSnapshot["notices"][number][] = []
		if ((storage.isFallback() || pageStorageUnavailable) && error?.code !== "storage-unavailable")
			notices.push("storage-unavailable")
		if (generation === "recovery-exhausted") notices.push("recovery-unavailable")
		return notices
	}

	function activeTools(): ChatSnapshot["activeTools"] {
		// Only the newest answer can hold a running call, so avoid rescanning all history for every token.
		const latest = messages.findLast((message) => message.role === "assistant")
		if (latest === undefined) return []
		return latest.parts.flatMap((part) =>
			part.type === "dynamic-tool" && part.state === "input-available"
				? [
						{
							toolCallId: part.toolCallId,
							serverName: part.toolMetadata.serverName ?? "",
							toolName: part.toolMetadata.displayName,
							source: part.toolMetadata.source,
						},
					]
				: [],
		)
	}

	function createSnapshot(): ChatSnapshot {
		const isAvailable = configuration?.isAvailable === true
		const availableAfterError = newChatAvailable()
		const latest = messages.at(-1)
		const visibleError: ChatError | undefined = hasUncertainWebsiteAction(latest)
			? { ...error, code: "website-action-uncertain", retriable: false }
			: error
		return {
			isAvailable,
			configuration,
			activeTools: activeTools(),
			messages,
			activity: currentActivity(),
			actions: snapshotActions(isAvailable, availableAfterError),
			notices: snapshotNotices(),
			acceptedMessageId,
			error: visibleError && { ...visibleError, newChatAvailable: availableAfterError },
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
			tools: [],
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

	function pendingReplayCandidate(sessionCredential: string): PendingRecoveryAttempt | undefined {
		if (pendingMessage === undefined || pendingMessage.clientTools) return undefined
		return { ...pendingMessage, credential: sessionCredential }
	}

	async function replayPendingIfPresent(
		attempted: PendingRecoveryAttempt | undefined,
		controller: AbortController,
	): Promise<void> {
		if (attempted === undefined) return
		await replayPending(attempted, controller.signal)
	}

	function missingClientToolRequest(session: SessionState): boolean {
		return (
			pendingMessage?.clientTools === true &&
			!session.messages.some((message) => message.requestId === pendingMessage?.requestId)
		)
	}

	function clientToolRecoveryDenied(cause: unknown): boolean {
		return (
			pendingMessage?.clientTools === true &&
			cause instanceof ChatTransportError &&
			cause.detail.status === HTTP_UNAUTHORIZED
		)
	}

	async function clearPendingMessage(sessionCredential: string): Promise<void> {
		if (pendingMessage === undefined) return
		pendingMessage = undefined
		await persist({ version: CHAT_STORAGE_VERSION, credential: sessionCredential })
	}

	async function recoverSession(controller: AbortController, delay: number): Promise<boolean> {
		let attempted: PendingRecoveryAttempt | undefined
		try {
			await wait(delay, controller.signal)
			if (credential === undefined) return true
			attempted = pendingReplayCandidate(credential)
			await replayPendingIfPresent(attempted, controller)
			const session = await transport.loadSession({ ...context(controller.signal), credential })
			if (missingClientToolRequest(session)) return false
			applySession(session)
			await clearPendingMessage(credential)
			return session.activeGeneration === undefined
		} catch (cause) {
			if (controller.signal.aborted) return true
			if (clientToolRecoveryDenied(cause)) return false
			if (isDefiniteRejection(cause)) {
				await rejectRecoveryAttempt(attempted, cause.detail)
				return true
			}
			return false
		}
	}

	async function exhaustRecovery(): Promise<void> {
		if (disposed || generation !== "recovery") return
		generation = "recovery-exhausted"
		messages = messages.map((message) =>
			message.outcome === "streaming" ? withOutcome(message, "interrupted") : message,
		)
		publish()
		// A client-tool send the server never recorded cannot be replayed, so stop restoring it on every reload.
		if (pendingMessage?.clientTools === true && credential !== undefined) {
			try {
				await clearPendingMessage(credential)
			} catch {
				// The usable in-memory state is already published; a failed write must not undo it.
			}
		}
	}

	async function pollRecovery(controller: AbortController): Promise<void> {
		const delays = options.recoveryDelays ?? DEFAULT_RECOVERY_DELAYS
		const attempt = async (poll: number): Promise<boolean> => {
			if (poll === MAX_RECOVERY_POLLS) return false
			const delay = delays[Math.min(poll, delays.length - 1)] ?? FIVE_SECONDS_MS
			return (await recoverSession(controller, delay)) || attempt(poll + 1)
		}
		if (!(await attempt(0))) await exhaustRecovery()
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
					parts: [{ type: "text", text: pendingMessage.text }],
					createdAt: now().toISOString(),
					outcome: "interrupted",
				},
			]
			generation = "recovery"
		}
	}

	function pageControlRequested(loaded: ChatConfiguration): boolean {
		return (
			!options.transport &&
			!!options.pageControl &&
			loaded.pageControl?.enabled === true &&
			typeof document !== "undefined"
		)
	}

	function pageExclude(): readonly Element[] {
		const exclude = options.pageControl?.exclude
		if (!exclude?.length) throw new Error("Page control requires the chat root in pageControl.exclude")
		return exclude
	}

	function hasPageToolSlot(): boolean {
		if (Object.hasOwn(customTools, PAGE_TOOL_NAME)) throw new Error("Reserved client tool name: talqo_page")
		if (tools.size < CLIENT_TOOL_LIMIT) return true
		console.warn("TalqoSDK: website actions unavailable because all 8 client tool slots are in use")
		return false
	}

	function installPageTool(loaded: ChatConfiguration): void {
		if (!pageControlRequested(loaded)) return
		pageStorageUnavailable = !canStorePageContinuation()
		if (pageStorageUnavailable) return
		if (!hasPageToolSlot()) return
		pageTool = createPageTool({
			approvalInstructions: loaded.pageControl?.approvalInstructions,
			exclude: pageExclude(),
			themeRoot: options.pageControl?.themeRoot,
			language: pageLanguage(loaded),
			stop: cancelResponse,
		})
		tools = captureClientTools({ ...customTools, [PAGE_TOOL_NAME]: pageTool.definition })
	}

	function readPageTurn(): PageContinuation | undefined {
		return pageTool ? readPageContinuation(options.apiUrl, options.embedToken) : undefined
	}

	function matchesCurrentSession(continuation: PageContinuation | undefined): continuation is PageContinuation {
		return !!continuation && continuation.credential === credential && continuation.generationId === activeGenerationId
	}

	function resumePageTurn(): boolean {
		const continuation = readPageTurn()
		if (!matchesCurrentSession(continuation)) return false
		generation = "idle"
		activeGenerationId = undefined
		void sendMessage(continuation.text, continuation).catch(() => {
			removePageContinuation(options.apiUrl, options.embedToken)
		})
		return true
	}

	async function loadInitialState(controller: AbortController): Promise<void> {
		const [loadedConfiguration, serialized] = await Promise.all([
			transport.loadConfiguration(context(controller.signal)),
			storage.getItem(storageKey),
		])
		configuration = loadedConfiguration
		if (loadedConfiguration.isAvailable) await restoreStoredSession(serialized, controller.signal)
		installPageTool(loadedConfiguration)
		initialization = "ready"
		publish()
		if (resumePageTurn()) return
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

	function newPageSession(): string | undefined {
		return pageTool ? randomUUID() : undefined
	}

	function beginSend(text: string, continuation?: PageContinuation): SendState {
		const newSession = credential === undefined
		credential ??= randomUUID()
		const sendCredential = credential
		const requestId = continuation?.requestId ?? randomUUID()
		const pageSession = continuation?.pageSession ?? newPageSession()
		const controller = new AbortController()
		pendingMessage = { requestId, text, ...(tools.size ? { clientTools: true } : {}) }
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
			rejected: false,
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
			pageSession,
		}
	}

	async function acceptSend(state: SendState, event: Extract<ChatEvent, { type: "accepted" }>): Promise<void> {
		state.accepted = true
		acceptedMessageId = event.userMessage.id
		activeGenerationId = event.generationId
		const assistant: ChatMessage = {
			id: event.assistantMessage.id,
			role: "assistant",
			text: "",
			parts: [],
			createdAt: event.assistantMessage.createdAt,
			outcome: "streaming",
		}
		const replaying = messages.some((message) => message.id === assistant.id)
		// Resume replays every part and delta from the start of the turn.
		messages = messages.map((message) => {
			if (message.id === state.localUserId)
				return { ...message, id: event.userMessage.id, createdAt: event.userMessage.createdAt, outcome: "completed" }
			return message.id === assistant.id ? assistant : message
		})
		state.assistantId = assistant.id
		if (!replaying) messages = [...messages, assistant]
		generation = "streaming"
		pendingMessage = undefined
		await persist({ version: CHAT_STORAGE_VERSION, credential: state.credential })
		publish()
	}

	function completeSend(state: SendState, event: Extract<ChatEvent, { type: "terminal" | "error" }>): void {
		state.terminalReceived = true
		if (state.assistantId !== undefined) {
			replaceMessage(state.assistantId, (message) => withOutcome(message, event.outcome))
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
				replaceMessage(state.assistantId, (message) => {
					const parts = [...message.parts]
					const part = parts[event.index]
					if (part?.type !== "text") throw new Error("Text delta targets a non-text part")
					parts[event.index] = { ...part, text: part.text + event.text }
					return {
						...message,
						text: parts
							.filter((item) => item.type === "text")
							.map((item) => item.text)
							.join(""),
						parts,
					}
				})
				publish()
				return
			case "part":
				replaceMessage(event.assistantMessageId, (message) => {
					if (event.index > message.parts.length) throw new Error("Out-of-order message part")
					const parts = [...message.parts]
					parts[event.index] = event.part
					return { ...message, parts }
				})
				publish()
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
			if (event.type === "accepted") {
				if (event.duplicate) {
					generation = "recovery"
					beginSessionRecoveryPolling()
					return
				}
				await acceptSend(state, event)
			} else applyActiveSendEvent(state, event)
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
			replaceMessage(state.assistantId, (message) => withOutcome(message, "interrupted"))
		}
		generation = "recovery"
		error = transportError(cause)
		beginSessionRecoveryPolling()
	}

	function handleStreamFailure(state: SendState, cause: unknown): void {
		if (state.send.cancellationRequested) {
			if (state.assistantId !== undefined) {
				replaceMessage(state.assistantId, (message) => withOutcome(message, "cancelled"))
			}
		} else if (!(cause instanceof ChatClientError)) {
			recoverSend(state, cause)
		}
	}

	async function sendMessage(text: string, continuation?: PageContinuation): Promise<void> {
		requireReadyToSend()
		requireIdleSend()
		if (text.length === 0) throw new Error("Message text must not be empty")
		const state = beginSend(text, continuation)
		try {
			await state.send.persisted
			const manifest = await tools.manifest()
			state.send.controller.signal.throwIfAborted()
			if (!continuation)
				messages = [
					...messages,
					{
						id: state.localUserId,
						role: "user",
						text,
						parts: [{ type: "text", text }],
						createdAt: now().toISOString(),
						outcome: "pending",
					},
				]
			error = undefined
			publish()
			state.send.dispatched = true
			const events = await transport.sendMessage({
				...context(state.send.controller.signal),
				text,
				requestId: state.requestId,
				credential: state.credential,
				tools: manifest,
				pageSession: state.pageSession,
				resume: continuation !== undefined,
			})
			await consumeSendEvents(state, events)
		} catch (cause) {
			if (sendWasDefinitelyRejected(state, cause)) {
				state.send.rejected = true
				await rejectPendingSend(state, cause)
			} else handleStreamFailure(state, cause)
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
			// A rejected send already removed its pending message, so there is nothing left to observe.
			if (!state.send?.rejected) await recoverCancelledPending(cause)
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

	function createCancellationState(): CancellationState {
		return {
			previousGeneration: generation,
			controller: new AbortController(),
			preAcceptance: activeSend !== undefined && activeGenerationId === undefined,
			send: activeSend,
		}
	}

	function preparePreAcceptanceCancellation(state: CancellationState): void {
		if (!state.preAcceptance || activeSend === undefined) return
		activeSend.cancellationRequested = true
		if (options.transport || !activeSend.dispatched) activeSend.controller.abort(new Error("Chat response cancelled"))
	}

	function settleCancellation(state: CancellationState, cancellation: Promise<void>): void {
		if (cancellationController === state.controller) cancellationController = undefined
		if (cancellationPromise === cancellation) cancellationPromise = undefined
	}

	function cancelResponse(): Promise<void> {
		requireUsable()
		if (cancellationPromise !== undefined) return cancellationPromise
		if (generation === "idle") return Promise.resolve()
		const state = createCancellationState()
		cancellationController = state.controller
		preparePreAcceptanceCancellation(state)
		generation = "cancelling"
		publish()
		const cancellation = performCancellation(state).finally(() => settleCancellation(state, cancellation))
		cancellationPromise = cancellation
		return cancellation
	}

	function lastFailedAssistantIndex(): number {
		const index = messages.length - 1
		const message = messages[index]
		if (message?.role !== "assistant" || message.outcome !== "failed")
			throw new Error("No failed response is available to retry")
		return index
	}

	async function retryLastMessage(): Promise<void> {
		requireUsable()
		if (error?.retriable !== true) throw new Error("The latest chat error is not retriable")
		if (hasClientToolAction(messages.at(-1))) throw new Error("A website action cannot be safely retried")
		const failedAssistantIndex = lastFailedAssistantIndex()
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
			pageTool?.dispose()
			initializationController?.abort(new Error("Chat client disposed"))
			activeSend?.controller.abort(new Error("Chat client disposed"))
			cancellationController?.abort(new Error("Chat client disposed"))
			recoveryController?.abort()
			listeners.clear()
		},
	}
}
