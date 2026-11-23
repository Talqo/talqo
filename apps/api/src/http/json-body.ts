import { env } from "@/config/env.ts"
import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { hasMatchedRoute } from "@/http/route-match.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { bodyLimit } from "hono/body-limit"
import { createMiddleware } from "hono/factory"
import { matchedRoutes } from "hono/route"

// Hard ceiling for inbound bodies; generous for the largest payload (system prompts up to 20k chars).
const REQUEST_BODY_MAX_BYTES = 262_144
// JSON may escape one astral code point as a surrogate pair of \uXXXX sequences (6 bytes each).
const MAX_JSON_BYTES_PER_CODE_POINT = 12
const CHAT_JSON_OVERHEAD_BYTES = 4096

const rejectOversizedJsonBody = bodyLimit({
	maxSize: REQUEST_BODY_MAX_BYTES,
	onError: (context) => problemResponse(context, PROBLEM_CODES.PAYLOAD_TOO_LARGE, HTTP_STATUS.PAYLOAD_TOO_LARGE),
})

function chatBodyLimit() {
	return bodyLimit({
		maxSize: env.TALQO_CHAT_MAX_INPUT_CHARACTERS * MAX_JSON_BYTES_PER_CODE_POINT + CHAT_JSON_OVERHEAD_BYTES,
		onError: (context) => problemResponse(context, PROBLEM_CODES.PAYLOAD_TOO_LARGE, HTTP_STATUS.PAYLOAD_TOO_LARGE),
	})
}

/** Mounted on a route to raise its body ceiling to the chat allowance; the global limit enforces it. */
export const allowChatSizedBody = createMiddleware(async (_context, next) => next())

export const rejectOversizedBody = createMiddleware(async (context, next) => {
	if (!context.req.header("Content-Type")?.startsWith("application/json")) return next()
	// Hono composes sub-app handlers unchanged unless the sub-app sets onError, so identity holds.
	if (matchedRoutes(context).some((route) => route.handler === allowChatSizedBody)) {
		return chatBodyLimit()(context, next)
	}
	return rejectOversizedJsonBody(context, next)
})

export const rejectMalformedJson = createMiddleware(async (context, next) => {
	if (!hasMatchedRoute(context)) return next()

	if (context.req.header("Content-Type")?.startsWith("application/json")) {
		// Bodyless operations still send the JSON content type, so an empty body is valid.
		if (context.req.header("Content-Length") !== "0") {
			try {
				await context.req.json()
			} catch {
				return problemResponse(context, PROBLEM_CODES.MALFORMED_JSON, HTTP_STATUS.BAD_REQUEST)
			}
		}
	}

	await next()
})
