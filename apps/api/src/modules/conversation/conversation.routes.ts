import type { Context } from "hono"

import { env } from "@/config/env.ts"
import { hashClientNetwork, resolveClientNetwork } from "@/http/client-network.ts"
import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { annotate, annotator, deferWideEvent } from "@/http/wide-event.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import type { ChatEvent } from "./conversation.service.ts"

import {
	cancelRoute,
	cancelTestChatRoute,
	conversationListResponseSchema,
	conversationTranscriptResponseSchema,
	getConversationRoute,
	getTestChatSessionRoute,
	listConversationsRoute,
	sendRoute,
	sendTestChatMessageRoute,
	sessionRoute,
	sessionStateSchema,
} from "./conversation.contract.ts"
import { InvalidChatInputError } from "./conversation.errors.ts"
import { getConversationService, getConversationTranscript, listConversations } from "./conversation.service.ts"

type ConversationService = Pick<ReturnType<typeof getConversationService>, "cancel" | "getSession" | "send">
export type ChatBindings = { peerAddress?: string }
type ChatEnv = { Bindings: ChatBindings; Variables: { chatCredential: string } }
type StartedChat = { done: Promise<void> }
type PeerSource = (context: { env?: ChatBindings; req: { header(name: string): string | undefined } }) => {
	forwardedFor: string | undefined
	peerAddress: string | undefined
}

type ToolCounts = { calls: number; failures: number }

function sse(event: ChatEvent): Uint8Array {
	return new TextEncoder().encode(`event: chat\ndata: ${JSON.stringify(event)}\n\n`)
}

function annotateOutcome(c: Context, event: Extract<ChatEvent, { type: "terminal" | "error" }>): void {
	if (event.type === "terminal") annotate(c, { "chat.outcome": event.outcome })
	else annotate(c, { "chat.outcome": event.outcome, "error.code": event.error.code })
}

function annotateToolEvent(
	c: Context,
	event: Extract<ChatEvent, { type: "tool-start" | "tool-end" }>,
	counts: ToolCounts,
): void {
	if (event.type === "tool-start") {
		annotate(c, { "chat.tool_calls": (counts.calls += 1) })
		return
	}
	if (event.outcome === "failed") annotate(c, { "chat.tool_failures": (counts.failures += 1) })
}

function annotateChatEvent(c: Context, event: ChatEvent, counts: ToolCounts): void {
	if (event.type === "accepted") annotate(c, { "generation.id": event.generationId })
	else if (event.type === "terminal" || event.type === "error") annotateOutcome(c, event)
	else if (event.type === "tool-start" || event.type === "tool-end") annotateToolEvent(c, event, counts)
}

/** Pre-stream failures throw as problem details; once accepted, events stream as SSE until generation settles. */
async function streamChat(
	c: Context,
	start: (emit: (event: ChatEvent) => void) => Promise<StartedChat>,
): Promise<Response> {
	const pending: Uint8Array[] = []
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined
	const toolCounts: ToolCounts = { calls: 0, failures: 0 }
	const emit = (event: ChatEvent) => {
		// The stream already answered 200, so a failure code lives only in the wide event.
		annotateChatEvent(c, event, toolCounts)
		const bytes = sse(event)
		if (controller) {
			try {
				controller.enqueue(bytes)
			} catch {
				controller = undefined
			}
		} else pending.push(bytes)
	}
	const result = await start(emit)
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
		const embedToken = c.req.param("embedToken")
		if (!embedToken) throw new InvalidChatInputError()
		const body = await c.req.json<{ requestId: string; text: string }>()
		return streamChat(c, (emit) =>
			activeService().send(
				{
					...body,
					credential: c.get("chatCredential"),
					embedToken,
					networkHash: hashClientNetwork(normalized, env.APP_SECRET),
				},
				emit,
				annotator(c),
			),
		)
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

type TestChatService = Pick<
	ReturnType<typeof getConversationService>,
	"cancelFromDashboard" | "getDashboardSession" | "sendFromDashboard"
>

export function createTestChatRoutes(service?: TestChatService) {
	const activeService = () => service ?? getConversationService()
	const testChat = new OpenAPIHono()
		.openapi(sendTestChatMessageRoute, (c) => {
			const body = c.req.valid("json")
			return streamChat(c, (emit) =>
				activeService().sendFromDashboard(
					{ ...body, agentId: c.req.valid("param").agentId, operatorId: c.get("user").id },
					emit,
					annotator(c),
				),
			)
		})
		.openapi(getTestChatSessionRoute, async (c) => {
			const session = await activeService().getDashboardSession({
				...c.req.valid("param"),
				operatorId: c.get("user").id,
			})
			return c.json(sessionStateSchema.parse(session), HTTP_STATUS.OK)
		})
		.openapi(cancelTestChatRoute, async (c) => {
			const body = c.req.valid("json") as { generationId?: string } | undefined
			await activeService().cancelFromDashboard({
				...c.req.valid("param"),
				generationId: body?.generationId,
				operatorId: c.get("user").id,
			})
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		})
	return new OpenAPIHono().route("/:agentId/test-chat", testChat)
}
