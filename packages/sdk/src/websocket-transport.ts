import type { ClientToolRegistry } from "./client-tools.ts"
import type { ClientToolManifest } from "./generated/models"
import type { ChatEvent, ChatTransport } from "./types.ts"

import { CLIENT_TOOL_CALL_LIMIT } from "./client-tools.ts"
import {
	ChatTransportError,
	createFetchChatTransport,
	type FetchChatTransportOptions,
	parseChatEvent,
} from "./fetch-transport.ts"
import { ChatServerFrameV1 } from "./generated/models/chatServerFrameV1.zod.ts"
import { isChatErrorCode } from "./types.ts"

const SOCKET_BUFFER_BYTES = 8_388_608
const encoder = new TextEncoder()

export function createWebSocketChatTransport(
	tools: ClientToolRegistry,
	options: FetchChatTransportOptions = {},
): ChatTransport {
	const http = createFetchChatTransport(options)
	const sockets = new Map<string, { cancel(): Promise<void> }>()
	return {
		...http,
		async sendMessage(input) {
			if (sockets.has(input.credential)) throw new Error("A chat connection is already active")
			let cancelled = false
			let cancelLive: (() => Promise<void>) | undefined
			sockets.set(input.credential, {
				async cancel() {
					cancelled = true
					await cancelLive?.()
				},
			})
			let manifest: ClientToolManifest
			let ws: WebSocket
			try {
				manifest = input.tools ?? (await tools.manifest())
				input.signal.throwIfAborted()
				if (cancelled) throw new Error("Chat send cancelled before connection")
				const url = new URL(input.apiUrl)
				url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
				url.pathname = `/api/chat/${encodeURIComponent(input.embedToken)}/socket`
				url.search = ""
				url.hash = ""
				ws = new WebSocket(url)
			} catch (error) {
				sockets.delete(input.credential)
				throw error
			}
			const queue: { event: ChatEvent; bytes: number }[] = []
			let bufferedBytes = 0
			let wake: (() => void) | undefined
			let failure: unknown
			let closed = false
			let terminal = false
			let accepted = false
			const dispatched = new Set<string>()
			const advertisedNames = new Set(manifest.map((definition) => definition.name))
			const controller = new AbortController()
			const listeners = new AbortController()
			const acceptance = Promise.withResolvers<void>()
			const opened = Promise.withResolvers<void>()
			const settled = Promise.withResolvers<void>()
			function finish() {
				closed = true
				controller.abort()
				listeners.abort()
				input.signal.removeEventListener("abort", abort)
				sockets.delete(input.credential)
				if (!accepted) acceptance.reject(failure ?? new ChatTransportError({ code: "transport-error" }))
				opened.resolve()
				wake?.()
				settled.resolve()
			}
			function abort() {
				ws.close()
				finish()
			}
			input.signal.addEventListener("abort", abort, { once: true })
			cancelLive = async () => {
				controller.abort()
				await opened.promise
				if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ version: 1, type: "cancel" }))
				await settled.promise
			}
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
					opened.resolve()
				},
				{ signal: listeners.signal },
			)
			ws.addEventListener(
				"error",
				() => {
					failure = new ChatTransportError({ code: "transport-error" })
					ws.close()
					finish()
				},
				{ signal: listeners.signal },
			)
			ws.addEventListener("close", finish, { signal: listeners.signal })
			ws.addEventListener(
				"message",
				(event: MessageEvent<unknown>) => {
					if (terminal) return
					try {
						if (typeof event.data !== "string") throw new Error("Binary chat frame")
						const bytes = encoder.encode(event.data).length
						if (bytes + bufferedBytes > SOCKET_BUFFER_BYTES) throw new Error("Chat buffer limit exceeded")
						const frame = ChatServerFrameV1.parse(JSON.parse(event.data))
						if (frame.type === "rejected") {
							failure = new ChatTransportError({
								code: isChatErrorCode(frame.code) ? frame.code : "invalid-response",
								status: frame.status,
								retryAt: frame.retryAt,
							})
							ws.close()
							finish()
							return
						}
						if (frame.type === "accepted") {
							if (accepted) throw new Error("Duplicate acceptance")
							accepted = true
							acceptance.resolve()
						} else if (!accepted) throw new Error("Chat frame before acceptance")
						if (frame.type === "tool-call") {
							if (dispatched.has(frame.toolCallId)) return
							const execute = async () => {
								if (!advertisedNames.has(frame.toolName)) throw new Error("Unadvertised client tool")
								if (dispatched.size >= CLIENT_TOOL_CALL_LIMIT) throw new Error("Client tool call limit reached")
								dispatched.add(frame.toolCallId)
								return tools.execute(frame, controller.signal)
							}
							void execute().then(
								(output) => {
									if (!controller.signal.aborted && ws.readyState === WebSocket.OPEN)
										ws.send(JSON.stringify({ version: 1, type: "tool-result", toolCallId: frame.toolCallId, output }))
								},
								() => {
									if (!controller.signal.aborted && ws.readyState === WebSocket.OPEN)
										ws.send(
											JSON.stringify({
												version: 1,
												type: "tool-error",
												toolCallId: frame.toolCallId,
												error: "Website tool failed",
											}),
										)
								},
							)
							return
						}
						const parsed = parseChatEvent(frame, "chat")
						if (!parsed) throw new Error("Invalid chat event")
						queue.push({ event: parsed, bytes })
						bufferedBytes += bytes
						if (parsed.type === "terminal" || parsed.type === "error") {
							terminal = true
							controller.abort()
						}
						wake?.()
					} catch {
						failure = new ChatTransportError({ code: "invalid-response" })
						ws.close()
						finish()
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
									ws.close()
									finish()
									return { done: true, value: undefined }
								}
								// oxlint-disable-next-line no-await-in-loop -- consume frames in socket order.
								await new Promise<void>((resolve) => {
									wake = resolve
								})
							}
						},
						async return(): Promise<IteratorResult<ChatEvent>> {
							ws.close()
							finish()
							return { done: true, value: undefined }
						},
					}
				},
			}
		},
		async cancelResponse(input) {
			const socket = sockets.get(input.credential)
			if (socket) await socket.cancel()
			else await http.cancelResponse(input)
		},
	}
}
