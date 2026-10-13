import type { ProblemCode } from "@/http/problem.ts"
import type { AiProviderId } from "@/modules/ai-provider/ai-provider.registry.ts"
import type { GenerationAttemptOutcome } from "@/modules/conversation/conversation.schema.ts"
import type { AllowedExtension } from "@/modules/knowledge-base/knowledge-base.service.ts"
import type { Context, MiddlewareHandler } from "hono"

import { matchedRoutePath } from "@/http/route-match.ts"
import { stdoutWideEventLog } from "@/http/wide-event-stdout.ts"

// One event per API request. Before adding a field, run the checklist in docs/architecture.md#observability.
export type WideEvent = {
	"request.id": string
	"http.request.method": string
	// Route template such as /api/agents/:agentId; null when no route matched.
	"http.route": string | null
	"http.response.status_code": number
	// For streamed responses, measured until the stream's work settles.
	duration_ms: number
	"auth.kind"?: "chat_bearer" | "public" | "session"
	"user.id"?: string
	// The user an admin action targets; `user.id` is the actor.
	"target.user.id"?: string
	"agent.id"?: string
	"embed.id"?: string
	"error.code"?: ProblemCode
	// Exception class only; messages may carry user data.
	"error.type"?: string
	"generation.id"?: string
	"chat.request_id"?: string
	"chat.new_conversation"?: boolean
	// Code points after history and knowledge base context; compare with TALQO_CHAT_MAX_INPUT_CHARACTERS.
	"chat.prompt_characters"?: number
	"chat.outcome"?: GenerationAttemptOutcome
	"chat.duplicate"?: boolean
	"chat.tool_calls"?: number
	"chat.tool_failures"?: number
	"rag.chunks"?: number
	// Retrieval failed, so the answer ran without knowledge base context.
	"rag.degraded"?: boolean
	"gen_ai.provider.name"?: AiProviderId
	"gen_ai.response.model"?: string
	"gen_ai.usage.input_tokens"?: number
	"gen_ai.usage.output_tokens"?: number
	"ai.text.provider"?: AiProviderId
	"ai.text.model"?: string
	"ai.embedding.provider"?: AiProviderId
	"ai.embedding.model"?: string
	// The ingestion worker re-embeds every knowledge base file after this change.
	"ai.embedding.changed"?: boolean
	"mcp.server.id"?: string
	"mcp.transport"?: "http" | "stdio"
	// 0 means the connection offered no tools; the operator sees it as not working.
	"mcp.tools_discovered"?: number
	// A changed endpoint discards the operator's tool selection.
	"mcp.endpoint_changed"?: boolean
	"mcp.servers_degraded"?: number
	"file.extension"?: AllowedExtension | "other"
	"file.size"?: number
}

export type Annotation = Omit<
	WideEvent,
	"duration_ms" | "http.request.method" | "http.response.status_code" | "http.route" | "request.id"
>
// Lets services report fields without depending on the HTTP context.
export type Annotate = (fields: Annotation) => void
type RequestState = { deferred?: Promise<unknown>; fields: Annotation }

export const REQUEST_ID_HEADER = "X-Request-Id"
// Bounded and log-safe, so a caller-supplied ID can correlate across proxies without injecting content.
const INBOUND_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/

const requests = new WeakMap<Context, RequestState>()

export function annotate(context: Context, fields: Annotation): void {
	const state = requests.get(context)
	if (state) Object.assign(state.fields, fields)
}

export function annotator(context: Context): Annotate {
	return (fields) => annotate(context, fields)
}

// Streaming handlers return before their work ends; the event is written once `work` settles.
export function deferWideEvent(context: Context, work: Promise<unknown>): void {
	const state = requests.get(context)
	if (state) state.deferred = work
}

function routeIds(context: Context): Annotation {
	const agentId = context.req.param("agentId")
	const embedId = context.req.param("embedId")
	const serverId = context.req.param("serverId")
	const userId = context.req.param("userId")
	return {
		...(agentId && { "agent.id": agentId }),
		...(embedId && { "embed.id": embedId }),
		...(serverId && { "mcp.server.id": serverId }),
		...(userId && { "target.user.id": userId }),
	}
}

export function createWideEvents(write: (event: WideEvent) => void): MiddlewareHandler {
	return async (context, next) => {
		const start = performance.now()
		const inbound = context.req.header(REQUEST_ID_HEADER)
		const requestId = inbound && INBOUND_REQUEST_ID.test(inbound) ? inbound : Bun.randomUUIDv7()
		const state: RequestState = { fields: {} }
		requests.set(context, state)

		await next()

		// Logging must never fail or delay the response, so every failure below is swallowed.
		try {
			context.res.headers.set(REQUEST_ID_HEADER, requestId)
		} catch {
			// Immutable response headers; the event still carries the ID.
		}
		const emit = () => {
			try {
				write({
					"request.id": requestId,
					"http.request.method": context.req.method,
					"http.route": matchedRoutePath(context),
					"http.response.status_code": context.res.status,
					duration_ms: Math.round(performance.now() - start),
					...routeIds(context),
					...state.fields,
				})
			} catch {
				// Dropped event; the request outcome is unaffected.
			}
		}
		if (state.deferred) void state.deferred.then(emit, emit)
		else emit()
	}
}

export const wideEvents = createWideEvents((event) => stdoutWideEventLog.write(event))
