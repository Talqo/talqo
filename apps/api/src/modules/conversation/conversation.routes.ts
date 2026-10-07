import type { Context } from "hono"

import { env } from "@/config/env.ts"
import { hashClientNetwork, resolveClientNetwork } from "@/http/client-network.ts"
import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import type { ChatEvent } from "./conversation.service.ts"

import { cancelRoute, sendRoute, sessionRoute, sessionStateSchema } from "./conversation.contract.ts"
import { InvalidChatInputError } from "./conversation.errors.ts"
import { getConversationService } from "./conversation.service.ts"

type ConversationService = Pick<ReturnType<typeof getConversationService>, "cancel" | "getSession" | "send">
export type ChatBindings = { peerAddress?: string }
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
		const pending: Uint8Array[] = []
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined
		const emit = (event: ChatEvent) => {
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
		)
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
