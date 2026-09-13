import type { Context } from "hono"

import { env } from "@/config/env.ts"
import { hashClientNetwork, resolveClientNetwork } from "@/http/client-network.ts"
import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import type { ChatEvent } from "./conversation.service.ts"

import {
	attemptRoute,
	bootstrapCancelRoute,
	bootstrapSendRoute,
	cancelRoute,
	recoverRoute,
	sendRoute,
	sessionRoute,
	sessionStateSchema,
} from "./conversation.contract.ts"
import {
	ConcurrentGenerationLimitError,
	ConversationTooLongError,
	DailyAllowanceExceededError,
	getConversationService,
	InvalidChatInputError,
	ProviderUnavailableError,
	RequestConflictError,
	SessionBusyError,
	SessionUnauthorizedError,
} from "./conversation.service.ts"

type ConversationService = Pick<
	ReturnType<typeof getConversationService>,
	"cancel" | "cancelBootstrap" | "getAttempt" | "getSession" | "recoverBootstrap" | "send"
>
export type ChatBindings = { peerAddress?: string }
type PeerSource = (context: { env?: ChatBindings; req: { header(name: string): string | undefined } }) => {
	forwardedFor: string | undefined
	peerAddress: string | undefined
}
const UTC_RESET_HOUR = 24
const MILLISECONDS_PER_SECOND = 1000

function bearer(header: string | undefined): string | undefined {
	const match = /^Bearer ([^\s]+)$/.exec(header ?? "")
	return match?.[1]
}

function mapError(c: Parameters<typeof problemResponse>[0], error: unknown): Response | undefined {
	if (error instanceof SessionUnauthorizedError)
		return problemResponse(c, PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED)
	if (error instanceof RequestConflictError)
		return problemResponse(c, PROBLEM_CODES.CHAT_REQUEST_CONFLICT, HTTP_STATUS.CONFLICT)
	if (error instanceof ConversationTooLongError)
		return problemResponse(c, PROBLEM_CODES.CHAT_CONVERSATION_TOO_LONG, HTTP_STATUS.BAD_REQUEST)
	if (error instanceof DailyAllowanceExceededError) {
		const reset = new Date()
		reset.setUTCHours(UTC_RESET_HOUR, 0, 0, 0)
		c.header("Retry-After", String(Math.max(1, Math.ceil((reset.getTime() - Date.now()) / MILLISECONDS_PER_SECOND))))
		c.header("X-RateLimit-Reset", reset.toISOString())
		return problemResponse(c, PROBLEM_CODES.CHAT_DAILY_ALLOWANCE_EXCEEDED, HTTP_STATUS.TOO_MANY_REQUESTS)
	}
	if (error instanceof ConcurrentGenerationLimitError || error instanceof SessionBusyError) {
		c.header("Retry-After", "1")
		return problemResponse(
			c,
			error instanceof SessionBusyError ? PROBLEM_CODES.CHAT_SESSION_BUSY : PROBLEM_CODES.CHAT_CONCURRENCY_LIMIT,
			HTTP_STATUS.TOO_MANY_REQUESTS,
		)
	}
	if (error instanceof InvalidChatInputError)
		return problemResponse(c, PROBLEM_CODES.INVALID_REQUEST, HTTP_STATUS.BAD_REQUEST)
	if (error instanceof ProviderUnavailableError)
		return problemResponse(c, PROBLEM_CODES.PROVIDER_ERROR, HTTP_STATUS.BAD_GATEWAY)
	return undefined
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

	async function send(c: Context<{ Bindings: ChatBindings }>, first: boolean) {
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
		try {
			const body = await c.req.json<{ bootstrapSecret?: string; requestId: string; text: string }>()
			const result = await activeService().send(
				{
					...body,
					networkHash: hashClientNetwork(normalized, env.APP_SECRET),
					...(first
						? { embedToken: c.req.param("embedToken") }
						: { credential: bearer(c.req.header("authorization")) }),
				},
				emit,
			)
			const stream = new ReadableStream<Uint8Array>({
				start(value) {
					controller = value
					for (const bytes of pending.splice(0)) value.enqueue(bytes)
					void result.done.finally(() => {
						try {
							value.close()
						} catch {
							// Client disconnects do not cancel persisted generation work.
						}
					})
				},
				cancel() {
					controller = undefined
				},
			})
			return new Response(stream, {
				status: HTTP_STATUS.OK,
				headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
			})
		} catch (error) {
			const mapped = mapError(c, error)
			if (mapped) return mapped
			throw error
		}
	}

	return routes
		.openapi(bootstrapSendRoute, (c) => send(c, true))
		.openapi(sendRoute, (c) => send(c, false))
		.openapi(recoverRoute, async (c) => {
			try {
				const result = await activeService().recoverBootstrap({
					...c.req.valid("json"),
					embedToken: c.req.valid("param").embedToken,
				})
				if (result.status !== "accepted") {
					return problemResponse(c, PROBLEM_CODES.CHAT_BOOTSTRAP_NOT_ACCEPTED, HTTP_STATUS.NOT_FOUND) as never
				}
				return c.json(result, HTTP_STATUS.OK)
			} catch (error) {
				const mapped = mapError(c, error)
				if (mapped) return mapped as never
				throw error
			}
		})
		.openapi(sessionRoute, async (c) => {
			try {
				const credential = bearer(c.req.header("authorization"))
				if (!credential) throw new SessionUnauthorizedError()
				return c.json(sessionStateSchema.parse(await activeService().getSession(credential)), HTTP_STATUS.OK)
			} catch (error) {
				const mapped = mapError(c, error)
				if (mapped) return mapped as never
				throw error
			}
		})
		.openapi(attemptRoute, async (c) => {
			try {
				const credential = bearer(c.req.header("authorization"))
				if (!credential) throw new SessionUnauthorizedError()
				return c.json(await activeService().getAttempt(credential, c.req.valid("param").generationId), HTTP_STATUS.OK)
			} catch (error) {
				const mapped = mapError(c, error)
				if (mapped) return mapped as never
				throw error
			}
		})
		.openapi(cancelRoute, async (c) => {
			try {
				const credential = bearer(c.req.header("authorization"))
				if (!credential) throw new SessionUnauthorizedError()
				const body = c.req.valid("json") as { generationId?: string } | undefined
				await activeService().cancel(credential, body?.generationId)
				return c.body(null, HTTP_STATUS.NO_CONTENT)
			} catch (error) {
				const mapped = mapError(c, error)
				if (mapped) return mapped as never
				throw error
			}
		})
		.openapi(bootstrapCancelRoute, async (c) => {
			try {
				const result = await activeService().cancelBootstrap({
					...c.req.valid("json"),
					embedToken: c.req.valid("param").embedToken,
				})
				if (result === "not-accepted") {
					return problemResponse(c, PROBLEM_CODES.CHAT_BOOTSTRAP_NOT_ACCEPTED, HTTP_STATUS.NOT_FOUND) as never
				}
				return c.body(null, HTTP_STATUS.NO_CONTENT)
			} catch (error) {
				const mapped = mapError(c, error)
				if (mapped) return mapped as never
				throw error
			}
		})
}
