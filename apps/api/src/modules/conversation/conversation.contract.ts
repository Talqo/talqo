import { MAX_CHAT_INPUT_CHARACTERS } from "@/config/env.ts"
import { chatBearerSecurity, payloadTooLargeResponse, problemResponse } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import { createRoute, z } from "@hono/zod-openapi"

const requestIdSchema = z.uuid({ version: "v4" })

const terminalOutcome = z.enum(["completed", "failed", "cancelled", "blocked", "interrupted"])
const chatErrorSchema = z.object({
	code: z.string(),
	retryAt: z.iso.datetime().optional(),
	retriable: z.boolean(),
	newChatAvailable: z.boolean(),
})
export const chatEventSchema = z
	.discriminatedUnion("type", [
		z.object({
			version: z.literal(1),
			type: z.literal("accepted"),
			requestId: requestIdSchema,
			generationId: z.string(),
			userMessage: z.object({ id: z.string(), createdAt: z.iso.datetime() }),
			assistantMessage: z.object({ id: z.string(), createdAt: z.iso.datetime() }),
		}),
		z.object({
			version: z.literal(1),
			type: z.literal("delta"),
			assistantMessageId: z.string(),
			text: z.string(),
		}),
		z.object({ version: z.literal(1), type: z.literal("terminal"), outcome: terminalOutcome }),
		z.object({
			version: z.literal(1),
			type: z.literal("error"),
			outcome: z.enum(["failed", "cancelled", "blocked", "interrupted"]),
			error: chatErrorSchema,
		}),
	])
	.openapi("ChatEventV1")

const messageOutcome = z.enum(["streaming", "completed", "failed", "cancelled", "blocked", "interrupted"])
const messageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant"]),
	text: z.string(),
	createdAt: z.iso.datetime(),
	outcome: messageOutcome,
})
export const sessionStateSchema = z.object({
	messages: z.array(messageSchema),
	activeGeneration: z.object({ id: z.string() }).optional(),
})
const sendBody = z.object({
	requestId: requestIdSchema,
	text: z
		.string()
		.min(1)
		.refine((text) => [...text].length <= MAX_CHAT_INPUT_CHARACTERS),
})
const cancelBody = z.object({ generationId: z.uuid({ version: "v4" }).optional() })
const embedParams = z.object({ embedToken: z.string().openapi({ param: { name: "embedToken", in: "path" } }) })
const badRequestProblems = problemResponse([
	PROBLEM_CODES.INVALID_REQUEST,
	PROBLEM_CODES.MALFORMED_JSON,
	PROBLEM_CODES.CHAT_CLIENT_ADDRESS_UNAVAILABLE,
	PROBLEM_CODES.CHAT_CONVERSATION_TOO_LONG,
])
const unauthorizedProblem = problemResponse([PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED])
const notFoundProblem = problemResponse([PROBLEM_CODES.EMBED_NOT_FOUND])
const conflictProblem = problemResponse([PROBLEM_CODES.CHAT_REQUEST_CONFLICT])
const rateLimitProblems = problemResponse([
	PROBLEM_CODES.CHAT_DAILY_ALLOWANCE_EXCEEDED,
	PROBLEM_CODES.CHAT_CONCURRENCY_LIMIT,
	PROBLEM_CODES.CHAT_SESSION_BUSY,
])
const sseResponse = {
	content: { "text/event-stream": { schema: chatEventSchema } },
	description: "Version 1 chat events",
} as const

export const sendRoute = createRoute({
	method: "post",
	path: "/{embedToken}/messages",
	operationId: "sendChatMessage",
	tags: ["Public Chat"],
	security: chatBearerSecurity,
	request: {
		params: embedParams,
		body: { required: true, content: { "application/json": { schema: sendBody } } },
	},
	responses: {
		200: sseResponse,
		400: badRequestProblems,
		401: unauthorizedProblem,
		404: notFoundProblem,
		409: conflictProblem,
		413: payloadTooLargeResponse,
		429: rateLimitProblems,
		502: problemResponse([PROBLEM_CODES.PROVIDER_ERROR]),
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})

export const sessionRoute = createRoute({
	method: "get",
	path: "/session",
	operationId: "getChatSession",
	tags: ["Public Chat"],
	security: chatBearerSecurity,
	responses: {
		200: { content: { "application/json": { schema: sessionStateSchema } }, description: "Conversation history" },
		401: problemResponse([PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED]),
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})

export const cancelRoute = createRoute({
	method: "post",
	path: "/cancel",
	operationId: "cancelChatGeneration",
	tags: ["Public Chat"],
	security: chatBearerSecurity,
	request: { body: { required: false, content: { "application/json": { schema: cancelBody } } } },
	responses: {
		204: { description: "Cancellation requested" },
		401: problemResponse([PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED]),
		413: payloadTooLargeResponse,
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})
