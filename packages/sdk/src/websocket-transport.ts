import type { ClientToolRegistry } from "./client-tools.ts"
import type { ClientToolManifest } from "./generated/models"
import type { ChatErrorCode, ChatEvent, ChatTransport } from "./types.ts"

import { CLIENT_TOOL_CALL_LIMIT } from "./client-tools.ts"
import { ChatServerFrameV1 } from "./generated/models/chatServerFrameV1.zod.ts"
import { type ChatHttpOptions, ChatTransportError, createChatHttpClient } from "./http-client.ts"
import { isChatErrorCode } from "./types.ts"

const SOCKET_BUFFER_BYTES = 8_388_608
const CANCEL_TIMEOUT_MS = 5_000
const encoder = new TextEncoder()

async function settlesWithin(promise: Promise<void>, milliseconds: number): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined
	await Promise.race([
		promise,
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, milliseconds)
		}),
	])
	clearTimeout(timer)
}

type ServerFrame = ReturnType<typeof ChatServerFrameV1.parse>
type ToolCallFrame = Extract<ServerFrame, { type: "tool-call" }>
type EventFrame = Exclude<ServerFrame, { type: "rejected" | "tool-call" }>

function validateErrorCode(code: string): ChatErrorCode {
	if (!isChatErrorCode(code)) throw new Error("Invalid chat error code")
	return code
}

function parseChatEvent(frame: EventFrame): ChatEvent {
	const { version: _version, ...message } = frame
	return message.type === "error"
		? { ...message, error: { ...message.error, code: validateErrorCode(message.error.code) } }
		: message
}

type WebSocketTransportOptions = ChatHttpOptions & {
	/** How long to wait for the server to confirm the turn's outcome after Stop. */
	cancelTimeoutMs?: number
}

export function createWebSocketChatTransport(
	tools: ClientToolRegistry,
	options: WebSocketTransportOptions = {},
): ChatTransport {
	const http = createChatHttpClient(options)
	const cancelTimeoutMs = options.cancelTimeoutMs ?? CANCEL_TIMEOUT_MS
	const activeSends = new Map<string, () => Promise<void>>()
	return {
		...http,
		async sendMessage(input) {
			if (activeSends.has(input.credential)) throw new Error("A chat connection is already active")
			let stopRequested = false
			activeSends.set(input.credential, async () => {
				stopRequested = true
			})
			let manifest: ClientToolManifest
			let ws: WebSocket
			try {
				manifest = input.tools ?? (await tools.manifest())
				input.signal.throwIfAborted()
				if (stopRequested) throw new Error("Chat send cancelled before connection")
				const url = new URL(input.apiUrl)
				url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
				url.pathname = `/api/chat/${encodeURIComponent(input.embedToken)}/socket`
				url.search = ""
				url.hash = ""
				ws = new WebSocket(url)
			} catch (error) {
				activeSends.delete(input.credential)
				throw error
			}
			const queue: { event: ChatEvent; bytes: number }[] = []
			let bufferedBytes = 0
			let wake: (() => void) | undefined
			let failure: ChatTransportError | undefined
			let closed = false
			let started = false
			let terminal = false
			let accepted = false
			const dispatched = new Set<string>()
			const advertisedNames = new Set(manifest.map((definition) => definition.name))
			const toolController = new AbortController()
			const listeners = new AbortController()
			const acceptance = Promise.withResolvers<void>()
			const settled = Promise.withResolvers<void>()
			function close() {
				if (closed) return
				closed = true
				listeners.abort()
				toolController.abort()
				ws.close()
				input.signal.removeEventListener("abort", close)
				activeSends.delete(input.credential)
				if (stopRequested && !terminal) failure ??= new ChatTransportError({ code: "cancel-failed" })
				if (!accepted) acceptance.reject(failure ?? new ChatTransportError({ code: "transport-error" }))
				wake?.()
				settled.resolve()
			}
			input.signal.addEventListener("abort", close, { once: true })
			activeSends.set(input.credential, async () => {
				stopRequested = started && !terminal
				toolController.abort()
				if (stopRequested && ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ version: 1, type: "cancel" }))
					await settlesWithin(settled.promise, cancelTimeoutMs)
				}
				close()
				// Surface the specific rejection or transport error; a generic cancel-failed is only the fallback.
				if (stopRequested && failure) throw failure
			})
			ws.addEventListener(
				"open",
				() => {
					ws.send(
						JSON.stringify({
							version: 1,
							type: "start",
							credential: input.credential,
							requestId: input.requestId,
							text: input.text,
							tools: manifest,
						}),
					)
					started = true
				},
				{ signal: listeners.signal },
			)
			ws.addEventListener(
				"error",
				() => {
					failure = new ChatTransportError({ code: "transport-error" })
					close()
				},
				{ signal: listeners.signal },
			)
			ws.addEventListener("close", close, { signal: listeners.signal })
			function rejectFrame(frame: Extract<ServerFrame, { type: "rejected" }>): void {
				failure = new ChatTransportError({
					code: isChatErrorCode(frame.code) ? frame.code : "invalid-response",
					status: frame.status,
					retryAt: frame.retryAt,
				})
				terminal = !accepted
				close()
			}
			function acceptFrame(): void {
				if (accepted) throw new Error("Duplicate acceptance")
				accepted = true
				acceptance.resolve()
			}
			function sendToolOutcome(
				toolCallId: string,
				result: { type: "tool-result"; output: unknown } | { type: "tool-error"; error: string },
			) {
				if (toolController.signal.aborted || ws.readyState !== WebSocket.OPEN) return
				ws.send(JSON.stringify({ version: 1, toolCallId, ...result }))
			}
			function dispatchToolCall(frame: ToolCallFrame): void {
				if (toolController.signal.aborted || dispatched.has(frame.toolCallId)) return
				void (async () => {
					if (!advertisedNames.has(frame.toolName)) throw new Error("Unadvertised client tool")
					if (dispatched.size >= CLIENT_TOOL_CALL_LIMIT) throw new Error("Client tool call limit reached")
					dispatched.add(frame.toolCallId)
					return tools.execute(frame, toolController.signal)
				})().then(
					(output) => sendToolOutcome(frame.toolCallId, { type: "tool-result", output }),
					() => sendToolOutcome(frame.toolCallId, { type: "tool-error", error: "Website tool failed" }),
				)
			}
			function enqueue(frame: EventFrame, bytes: number): void {
				const parsed = parseChatEvent(frame)
				queue.push({ event: parsed, bytes })
				bufferedBytes += bytes
				if (parsed.type === "terminal" || parsed.type === "error") {
					terminal = true
					toolController.abort()
					settled.resolve()
				}
				wake?.()
			}
			function handleFrame(frame: ServerFrame, bytes: number): void {
				if (frame.type === "rejected") {
					rejectFrame(frame)
					return
				}
				if (frame.type === "accepted") acceptFrame()
				else if (!accepted) throw new Error("Chat frame before acceptance")
				if (frame.type === "tool-call") {
					dispatchToolCall(frame)
					return
				}
				enqueue(frame, bytes)
			}
			ws.addEventListener(
				"message",
				(event: MessageEvent<unknown>) => {
					if (terminal) return
					try {
						if (typeof event.data !== "string") throw new Error("Binary chat frame")
						const bytes = encoder.encode(event.data).length
						if (bytes + bufferedBytes > SOCKET_BUFFER_BYTES) throw new Error("Chat buffer limit exceeded")
						handleFrame(ChatServerFrameV1.parse(JSON.parse(event.data)), bytes)
					} catch {
						failure = new ChatTransportError({ code: "invalid-response" })
						close()
					}
				},
				{ signal: listeners.signal },
			)
			await acceptance.promise
			return {
				[Symbol.asyncIterator]() {
					return {
						async next(): Promise<IteratorResult<ChatEvent>> {
							while (true) {
								const entry = queue.shift()
								if (entry) {
									bufferedBytes -= entry.bytes
									return { done: false, value: entry.event }
								}
								if (failure) throw failure
								if (closed || terminal) {
									close()
									return { done: true, value: undefined }
								}
								await new Promise<void>((resolve) => {
									wake = resolve
								})
							}
						},
						async return(): Promise<IteratorResult<ChatEvent>> {
							close()
							return { done: true, value: undefined }
						},
					}
				},
			}
		},
		async cancelResponse(input) {
			const stop = activeSends.get(input.credential)
			if (stop) await stop()
			else await http.cancelResponse(input)
		},
	}
}
