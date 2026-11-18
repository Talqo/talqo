import type { Context } from "hono"

import { env } from "@/config/env.ts"
import { hashClientNetwork, resolveClientNetwork } from "@/http/client-network.ts"
import { ApiError, PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { annotate, annotator, deferWideEvent } from "@/http/wide-event.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { upgradeWebSocket } from "hono/bun"

import type { MessagePart } from "./conversation.messages.ts"
import type { ChatEvent } from "./conversation.service.ts"

import {
	type ClientToolChannel,
	createClientToolChannel,
	MANIFEST_BYTES,
	TOOL_PAYLOAD_BYTES,
} from "./conversation.client-tools.ts"
import { createPageConnection } from "./conversation.connection.ts"
import {
	cancelRoute,
	chatClientFrameSchema,
	chatServerFrameSchema,
	conversationListResponseSchema,
	conversationTranscriptResponseSchema,
	getConversationRoute,
	listConversationsRoute,
	sessionRoute,
	sessionStateSchema,
	socketRoute,
} from "./conversation.contract.ts"
import { getConversationService, getConversationTranscript, listConversations } from "./conversation.service.ts"

type ConversationService = Pick<
	ReturnType<typeof getConversationService>,
	"authorizePageResume" | "cancel" | "getSession" | "send"
>
const SOCKET_POLICY_VIOLATION = 1008
const SOCKET_NORMAL_CLOSE = 1000
const SOCKET_START_DEADLINE_MS = 10_000
const FRAME_ENVELOPE_BYTES = 4096
const MAX_JSON_BYTES_PER_CODE_POINT = 12
const MILLISECONDS_PER_SECOND = 1000
const MAX_SERVER_FRAME_BYTES = 8_388_608
export type ChatBindings = { peerAddress?: string; server?: unknown }
type ChatEnv = { Bindings: ChatBindings }
type PeerSource = (context: { env?: ChatBindings; req: { header(name: string): string | undefined } }) => {
	forwardedFor: string | undefined
	peerAddress: string | undefined
}

type ToolCounts = { calls: number; failures: number }
type ClientFrame = ReturnType<typeof chatClientFrameSchema.parse>
type StartFrame = Extract<ClientFrame, { type: "start" }>
type ChatSocket = {
	close(code?: number, reason?: string): void
	send(data: string): void
}

function annotateOutcome(c: Context<ChatEnv>, event: Extract<ChatEvent, { type: "terminal" | "error" }>): void {
	if (event.type === "terminal") annotate(c, { "chat.outcome": event.outcome })
	else annotate(c, { "chat.outcome": event.outcome, "error.code": event.error.code })
}

function annotateToolEvent(c: Context<ChatEnv>, part: MessagePart, counts: ToolCounts): void {
	if (part.type !== "dynamic-tool") return
	if (part.state === "input-available") {
		annotate(c, { "chat.tool_calls": (counts.calls += 1) })
		return
	}
	if (part.toolMetadata.outcome === "failed") annotate(c, { "chat.tool_failures": (counts.failures += 1) })
}

function annotateChatEvent(c: Context<ChatEnv>, event: ChatEvent, counts: ToolCounts): void {
	if (event.type === "accepted") annotate(c, { "generation.id": event.generationId })
	else if (event.type === "terminal" || event.type === "error") annotateOutcome(c, event)
	else if (event.type === "part") annotateToolEvent(c, event.part, counts)
}

function parseClientFrame(data: string): ClientFrame | undefined {
	try {
		const parsed = chatClientFrameSchema.safeParse(JSON.parse(data))
		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

function rejectionFrame(error: unknown) {
	return {
		version: 1,
		type: "rejected",
		code: error instanceof ApiError ? error.problemCode : PROBLEM_CODES.INTERNAL_SERVER_ERROR,
		status: error instanceof ApiError ? error.status : HTTP_STATUS.INTERNAL_SERVER_ERROR,
		retryAt: error instanceof ApiError ? error.headers?.["X-RateLimit-Reset"] : undefined,
	}
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
	const pageConnections = new Map<string, ReturnType<typeof createPageConnection>>()
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
		let pageConnection: ReturnType<typeof createPageConnection> | undefined
		let socketSender: ((message: string) => void) | undefined
		let resuming = false
		let resumeCancellationRequested = false
		let started = false
		let closed = false
		const cancellation = new AbortController()
		let terminal = false
		let deadline: ReturnType<typeof setTimeout>
		let timeout: ReturnType<typeof setTimeout> | undefined
		const completion = Promise.withResolvers<void>()
		const toolCounts: ToolCounts = { calls: 0, failures: 0 }
		deferWideEvent(c, completion.promise)

		function sendFrame(ws: ChatSocket, message: unknown): void {
			if (closed) return
			const serialized = JSON.stringify(message)
			if (Buffer.byteLength(serialized) > MAX_SERVER_FRAME_BYTES) throw new Error("Chat frame too large")
			ws.send(serialized)
		}

		function failFrame(ws: ChatSocket): void {
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

		function frameLimit(): number {
			return started
				? TOOL_PAYLOAD_BYTES + FRAME_ENVELOPE_BYTES
				: env.TALQO_CHAT_MAX_INPUT_CHARACTERS * MAX_JSON_BYTES_PER_CODE_POINT + MANIFEST_BYTES + FRAME_ENVELOPE_BYTES
		}

		function sendTurnFrame(ws: ChatSocket, message: unknown): void {
			if (pageConnection) {
				pageConnection.send(message)
				return
			}
			sendFrame(ws, message)
		}

		async function runTurn(frame: StartFrame, ws: ChatSocket): Promise<void> {
			try {
				const result = await activeService().send(
					{
						...frame,
						embedToken,
						networkHash,
						clientTools: channel,
						cancellationSignal: cancellation.signal,
						clientManifestFingerprint: frame.tools.length
							? new Bun.CryptoHasher("sha256").update(JSON.stringify(frame.tools)).digest("hex")
							: undefined,
					},
					(message) => {
						if (message.type === "terminal" || message.type === "error") terminal = true
						annotateChatEvent(c, message, toolCounts)
						sendTurnFrame(ws, message)
					},
					annotator(c),
				)
				await result.done
			} catch (error) {
				sendTurnFrame(ws, rejectionFrame(error))
			} finally {
				clearTimeout(timeout)
				completion.resolve()
				if (frame.pageSession) pageConnections.delete(frame.pageSession)
				pageConnection?.finish()
				ws.close(SOCKET_NORMAL_CLOSE)
			}
		}

		function isPageStartRejected(frame: StartFrame): boolean {
			if (started) return true
			if (!frame.pageSession) return false
			return pageConnections.has(frame.pageSession) || !frame.tools.some((tool) => tool.name === "talqo_page")
		}

		function registerPageSession(frame: StartFrame, ws: ChatSocket): void {
			if (!frame.pageSession) return
			const send = (message: string) => ws.send(message)
			socketSender = send
			pageConnection = createPageConnection({
				credential: frame.credential,
				embedToken,
				origin,
				send,
				close: () => ws.close(SOCKET_NORMAL_CLOSE),
				cancel: () => cancellation.abort(),
			})
			pageConnections.set(frame.pageSession, pageConnection)
		}

		function createTurnChannel(frame: StartFrame, ws: ChatSocket): void {
			if (!frame.tools.length) return
			channel = createClientToolChannel(
				frame.tools,
				(message) => sendTurnFrame(ws, message),
				env.TALQO_CHAT_MAX_INPUT_CHARACTERS,
			)
			pageConnection?.setChannel(channel)
		}

		function startTurn(frame: StartFrame, ws: ChatSocket): void {
			if (isPageStartRejected(frame)) {
				failFrame(ws)
				return
			}
			started = true
			clearTimeout(deadline)
			registerPageSession(frame, ws)
			createTurnChannel(frame, ws)
			timeout = setTimeout(() => {
				channel?.interrupt()
				pageConnection?.finish()
				ws.close(SOCKET_POLICY_VIOLATION, "Turn deadline exceeded")
			}, env.TALQO_CHAT_GENERATION_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND)
			void runTurn(frame, ws)
		}

		function resumeTurn(frame: Extract<ClientFrame, { type: "resume" }>, ws: ChatSocket): void {
			if (started) {
				failFrame(ws)
				return
			}
			const connection = pageConnections.get(frame.pageSession)
			if (
				!connection ||
				connection.credential !== frame.credential ||
				connection.embedToken !== embedToken ||
				connection.origin !== origin
			) {
				failFrame(ws)
				return
			}
			started = true
			resuming = true
			const send = (message: string) => ws.send(message)
			socketSender = send
			clearTimeout(deadline)
			void (async () => {
				try {
					await activeService().authorizePageResume(frame.credential, embedToken)
					if (resumeCancellationRequested) connection.cancel()
					if (closed || terminal) return
					const attached = connection.attach(
						send,
						() => {
							terminal = true
							completion.resolve()
							ws.close(SOCKET_NORMAL_CLOSE)
						},
						() => ws.close(SOCKET_NORMAL_CLOSE),
					)
					if (!attached) {
						failFrame(ws)
						return
					}
					pageConnection = connection
					channel = connection.channel
				} catch {
					failFrame(ws)
				} finally {
					resuming = false
					if (!pageConnection) completion.resolve()
				}
			})()
		}

		function acceptToolFrame(
			frame: Extract<ClientFrame, { type: "tool-result" | "tool-error" }>,
			ws: ChatSocket,
		): void {
			if (cancellation.signal.aborted) return
			try {
				if (!channel) throw new Error("No client tools")
				channel.accept(
					frame.type === "tool-error"
						? { toolCallId: frame.toolCallId, error: frame.error }
						: { toolCallId: frame.toolCallId, output: frame.output },
				)
			} catch {
				failFrame(ws)
			}
		}

		function isStalePageFrame(): boolean {
			return !!(pageConnection && socketSender && !pageConnection.owns(socketSender))
		}

		function cancelTurn(): void {
			if (resuming) resumeCancellationRequested = true
			else if (pageConnection) pageConnection.cancel()
			else cancellation.abort()
		}

		function detachPageSocket(): boolean {
			if (!pageConnection || !socketSender || terminal) return false
			pageConnection.detach(socketSender)
			return true
		}

		function handleClientFrame(frame: ClientFrame, ws: ChatSocket): void {
			if (frame.type === "start") startTurn(frame, ws)
			else if (frame.type === "resume") resumeTurn(frame, ws)
			else if (!started) failFrame(ws)
			else if (isStalePageFrame()) return
			else if (frame.type === "cancel") cancelTurn()
			else acceptToolFrame(frame, ws)
		}

		return upgradeWebSocket(c, {
			onOpen(_event, ws) {
				deadline = setTimeout(() => {
					ws.close(SOCKET_POLICY_VIOLATION, "Start deadline exceeded")
					completion.resolve()
				}, SOCKET_START_DEADLINE_MS)
			},
			onMessage(event, ws) {
				if (terminal) return
				if (typeof event.data !== "string") {
					failFrame(ws)
					return
				}
				if (Buffer.byteLength(event.data) > frameLimit()) {
					failFrame(ws)
					return
				}
				const frame = parseClientFrame(event.data)
				if (!frame) {
					failFrame(ws)
					return
				}
				handleClientFrame(frame, ws)
			},
			onClose() {
				closed = true
				clearTimeout(deadline)
				if (!detachPageSocket()) {
					clearTimeout(timeout)
					channel?.interrupt()
				}
				if (!started || resuming) completion.resolve()
			},
			onError() {
				if (!detachPageSocket()) channel?.interrupt()
			},
		}).catch((error: unknown) => {
			completion.resolve()
			throw error
		})
	})

	return routes
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
