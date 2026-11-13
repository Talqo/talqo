import type { Context } from "hono"

import { env } from "@/config/env.ts"
import { hashClientNetwork, resolveClientNetwork } from "@/http/client-network.ts"
import { ApiError, PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { annotate, annotator, deferWideEvent } from "@/http/wide-event.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { upgradeWebSocket } from "hono/bun"
import { createHash } from "node:crypto"

import type { ChatEvent } from "./conversation.service.ts"

import {
	type ClientToolChannel,
	createClientToolChannel,
	MANIFEST_BYTES,
	TOOL_PAYLOAD_BYTES,
} from "./conversation.client-tools.ts"
import {
	cancelRoute,
	chatClientFrameSchema,
	chatServerFrameSchema,
	conversationListResponseSchema,
	conversationTranscriptResponseSchema,
	getConversationRoute,
	listConversationsRoute,
	sendRoute,
	sessionRoute,
	sessionStateSchema,
	socketRoute,
} from "./conversation.contract.ts"
import { InvalidChatInputError } from "./conversation.errors.ts"
import { getConversationService, getConversationTranscript, listConversations } from "./conversation.service.ts"

type ConversationService = Pick<ReturnType<typeof getConversationService>, "cancel" | "getSession" | "send">
const SOCKET_POLICY_VIOLATION = 1008
const SOCKET_NORMAL_CLOSE = 1000
const SOCKET_START_DEADLINE_MS = 10_000
const FRAME_ENVELOPE_BYTES = 4096
const MAX_JSON_BYTES_PER_CODE_POINT = 12
const MILLISECONDS_PER_SECOND = 1000
const MAX_SERVER_FRAME_BYTES = 8_388_608
export type ChatBindings = { peerAddress?: string; server?: unknown }
type ChatEnv = { Bindings: ChatBindings; Variables: { chatCredential: string } }
type PeerSource = (context: { env?: ChatBindings; req: { header(name: string): string | undefined } }) => {
	forwardedFor: string | undefined
	peerAddress: string | undefined
}

function sse(event: ChatEvent): Uint8Array {
	return new TextEncoder().encode(`event: chat\ndata: ${JSON.stringify(event)}\n\n`)
}

export function createConversationRoutes(
	service?: ConversationService,
	peerSource: PeerSource = (context) => ({
		peerAddress: context.env?.peerAddress,
		forwardedFor: context.req.header("x-forwarded-for"),
	}),
) {
	const routes = new OpenAPIHono<{ Bindings: ChatBindings }>({
		defaultHook: (result, context) => {
			if (!result.success) {
				return problemResponse(context, PROBLEM_CODES.INVALID_REQUEST, HTTP_STATUS.BAD_REQUEST)
			}
			return undefined
		},
	})

	const activeService = () => service ?? getConversationService()
	routes.openAPIRegistry.register("ChatClientFrameV1", chatClientFrameSchema)
	routes.openAPIRegistry.register("ChatServerFrameV1", chatServerFrameSchema)
	routes.openapi(socketRoute, async (c) => {
		if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
			return problemResponse(c, PROBLEM_CODES.INVALID_REQUEST, HTTP_STATUS.BAD_REQUEST)
		const origin = c.req.header("origin")
		if (origin) {
			try {
				const url = new URL(origin)
				if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) throw new Error("Invalid origin")
			} catch {
				return problemResponse(c, PROBLEM_CODES.INVALID_REQUEST, HTTP_STATUS.BAD_REQUEST)
			}
		}
		const peer = peerSource(c)
		const normalized = resolveClientNetwork(
			peer.peerAddress,
			peer.forwardedFor,
			env.TALQO_TRUSTED_PROXY_CIDRS,
			env.TALQO_RATE_LIMIT_IPV6_PREFIX_LENGTH,
		)
		if (!normalized) return problemResponse(c, PROBLEM_CODES.CHAT_CLIENT_ADDRESS_UNAVAILABLE, HTTP_STATUS.BAD_REQUEST)
		const networkHash = hashClientNetwork(normalized, env.APP_SECRET)
		const embedToken = c.req.valid("param").embedToken
		let channel: ClientToolChannel | undefined
		let started = false
		let closed = false
		const cancellation = new AbortController()
		let terminal = false
		let toolCalls = 0
		let toolFailures = 0
		let deadline: ReturnType<typeof setTimeout>
		let timeout: ReturnType<typeof setTimeout> | undefined
		const completion = Promise.withResolvers<void>()
		deferWideEvent(c, completion.promise)
		return upgradeWebSocket(c, {
			onOpen(_event, ws) {
				deadline = setTimeout(() => {
					ws.close(SOCKET_POLICY_VIOLATION, "Start deadline exceeded")
					completion.resolve()
				}, SOCKET_START_DEADLINE_MS)
			},
			onMessage(event, ws) {
				const fail = () => {
					if (!started)
						ws.send(
							JSON.stringify({
								version: 1,
								type: "rejected",
								code: PROBLEM_CODES.INVALID_REQUEST,
								status: HTTP_STATUS.BAD_REQUEST,
							}),
						)
					terminal = true
					channel?.interrupt()
					ws.close(SOCKET_POLICY_VIOLATION, "Invalid chat frame")
				}
				if (terminal) return
				if (typeof event.data !== "string") {
					fail()
					return
				}
				const limit = started
					? TOOL_PAYLOAD_BYTES + FRAME_ENVELOPE_BYTES
					: env.TALQO_CHAT_MAX_INPUT_CHARACTERS * MAX_JSON_BYTES_PER_CODE_POINT + MANIFEST_BYTES + FRAME_ENVELOPE_BYTES
				if (Buffer.byteLength(event.data) > limit) {
					fail()
					return
				}
				let value: unknown
				try {
					value = JSON.parse(event.data)
				} catch {
					fail()
					return
				}
				const parsed = chatClientFrameSchema.safeParse(value)
				if (!parsed.success) {
					fail()
					return
				}
				const frame = parsed.data
				if (frame.type === "start") {
					if (started) {
						fail()
						return
					}
					started = true
					clearTimeout(deadline)
					const sendFrame = (message: unknown) => {
						if (closed) return
						const serialized = JSON.stringify(message)
						if (Buffer.byteLength(serialized) > MAX_SERVER_FRAME_BYTES) throw new Error("Chat frame too large")
						ws.send(serialized)
					}
					if (frame.tools.length)
						channel = createClientToolChannel(frame.tools, sendFrame, env.TALQO_CHAT_MAX_INPUT_CHARACTERS)
					timeout = setTimeout(() => {
						channel?.interrupt()
						ws.close(SOCKET_POLICY_VIOLATION, "Turn deadline exceeded")
					}, env.TALQO_CHAT_GENERATION_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND)
					void (async () => {
						try {
							const result = await activeService().send(
								{
									...frame,
									embedToken,
									networkHash,
									clientTools: channel,
									cancellationSignal: cancellation.signal,
									clientManifestFingerprint: frame.tools.length
										? createHash("sha256").update(JSON.stringify(frame.tools)).digest("hex")
										: undefined,
								},
								(message) => {
									if (message.type === "accepted") annotate(c, { "generation.id": message.generationId })
									if (message.type === "terminal" || message.type === "error") {
										terminal = true
										annotate(c, { "chat.outcome": message.outcome })
									}
									if (message.type === "error") annotate(c, { "error.code": message.error.code })
									if (message.type === "tool-start") annotate(c, { "chat.tool_calls": ++toolCalls })
									if (message.type === "tool-end" && message.outcome === "failed")
										annotate(c, { "chat.tool_failures": ++toolFailures })
									sendFrame(message)
								},
								annotator(c),
							)
							await result.done
						} catch (error) {
							const retryAt = error instanceof ApiError ? error.headers?.["X-RateLimit-Reset"] : undefined
							sendFrame({
								version: 1,
								type: "rejected",
								code: error instanceof ApiError ? error.problemCode : PROBLEM_CODES.INTERNAL_SERVER_ERROR,
								status: error instanceof ApiError ? error.status : HTTP_STATUS.INTERNAL_SERVER_ERROR,
								retryAt,
							})
						} finally {
							clearTimeout(timeout)
							completion.resolve()
							ws.close(SOCKET_NORMAL_CLOSE)
						}
					})()
				} else if (!started) fail()
				else if (frame.type === "cancel") {
					cancellation.abort()
				} else {
					if (cancellation.signal.aborted) return
					try {
						if (!channel) throw new Error("No client tools")
						channel.accept(
							frame.type === "tool-error"
								? { toolCallId: frame.toolCallId, error: frame.error }
								: { toolCallId: frame.toolCallId, output: frame.output },
						)
					} catch {
						fail()
					}
				}
			},
			onClose() {
				closed = true
				clearTimeout(deadline)
				clearTimeout(timeout)
				channel?.interrupt()
				if (!started) completion.resolve()
			},
			onError() {
				channel?.interrupt()
			},
		})
	})

	async function send(c: Context<ChatEnv>) {
		const peer = peerSource(c)
		const normalized = resolveClientNetwork(
			peer.peerAddress,
			peer.forwardedFor,
			env.TALQO_TRUSTED_PROXY_CIDRS,
			env.TALQO_RATE_LIMIT_IPV6_PREFIX_LENGTH,
		)
		if (!normalized) {
			return problemResponse(c, PROBLEM_CODES.CHAT_CLIENT_ADDRESS_UNAVAILABLE, HTTP_STATUS.BAD_REQUEST)
		}
		const pending: Uint8Array[] = []
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined
		let toolCalls = 0
		let toolFailures = 0
		const emit = (event: ChatEvent) => {
			if (event.type === "accepted") annotate(c, { "generation.id": event.generationId })
			else if (event.type === "terminal") annotate(c, { "chat.outcome": event.outcome })
			// The stream already answered 200, so the failure code lives only here.
			else if (event.type === "error") annotate(c, { "chat.outcome": event.outcome, "error.code": event.error.code })
			else if (event.type === "tool-start") annotate(c, { "chat.tool_calls": (toolCalls += 1) })
			else if (event.type === "tool-end" && event.outcome === "failed") {
				annotate(c, { "chat.tool_failures": (toolFailures += 1) })
			}
			const bytes = sse(event)
			if (controller) {
				try {
					controller.enqueue(bytes)
				} catch {
					controller = undefined
				}
			} else pending.push(bytes)
		}
		const embedToken = c.req.param("embedToken")
		if (!embedToken) throw new InvalidChatInputError()
		const body = await c.req.json<{ requestId: string; text: string }>()
		const result = await activeService().send(
			{
				...body,
				credential: c.get("chatCredential"),
				embedToken,
				networkHash: hashClientNetwork(normalized, env.APP_SECRET),
			},
			emit,
			annotator(c),
		)
		deferWideEvent(c, result.done)
		const stream = new ReadableStream<Uint8Array>({
			start(value) {
				controller = value
				for (const bytes of pending.splice(0)) value.enqueue(bytes)
				void result.done
					.finally(() => {
						try {
							value.close()
						} catch {
							// Client disconnects do not cancel persisted generation work.
						}
					})
					// Swallow stream-tail failures; they stay recoverable from persisted state.
					.catch(() => undefined)
			},
			cancel() {
				controller = undefined
			},
		})
		return new Response(stream, {
			status: HTTP_STATUS.OK,
			headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
		})
	}

	return routes
		.openapi(sendRoute, send)
		.openapi(sessionRoute, async (c) => {
			const session = await activeService().getSession(c.get("chatCredential"))
			return c.json(sessionStateSchema.parse(session), HTTP_STATUS.OK)
		})
		.openapi(cancelRoute, async (c) => {
			const body = c.req.valid("json") as { generationId?: string } | undefined
			await activeService().cancel(c.get("chatCredential"), body?.generationId)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		})
}

export const conversationOperatorRoutes = new OpenAPIHono()
	.openapi(listConversationsRoute, async (c) => {
		const page = await listConversations(c.req.valid("query"), c.get("user").id)
		return c.json(conversationListResponseSchema.parse(page), HTTP_STATUS.OK)
	})
	.openapi(getConversationRoute, async (c) => {
		const conversation = await getConversationTranscript(c.req.valid("param").conversationId, c.get("user").id)
		return c.json(conversationTranscriptResponseSchema.parse({ conversation }), HTTP_STATUS.OK)
	})
