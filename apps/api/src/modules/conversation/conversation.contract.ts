import { CHAT_ABSOLUTE_MAX_INPUT_CHARACTERS } from "@/config/env.ts"
import { problemResponse } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import { createRoute, z } from "@hono/zod-openapi"

import { BOOTSTRAP_SECRET_BYTES, isCanonicalBase64Url, REQUEST_ID_BYTES } from "./conversation-crypto.ts"

const REQUEST_ID_ENCODED_LENGTH = 22
const BOOTSTRAP_SECRET_ENCODED_LENGTH = 43
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/
const BOOTSTRAP_SECRET_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

const fixedToken = (bytes: number, encodedLength: number, pattern: RegExp) =>
	z
		.string()
		.length(encodedLength)
		.regex(pattern)
		.refine((value) => isCanonicalBase64Url(value, bytes))
const requestIdSchema = fixedToken(REQUEST_ID_BYTES, REQUEST_ID_ENCODED_LENGTH, REQUEST_ID_PATTERN)
const bootstrapSecretSchema = fixedToken(
	BOOTSTRAP_SECRET_BYTES,
	BOOTSTRAP_SECRET_ENCODED_LENGTH,
	BOOTSTRAP_SECRET_PATTERN,
)

const terminalOutcome = z.enum(["completed", "failed", "cancelled", "blocked", "interrupted"])
const chatErrorSchema = z.object({
	code: z.string(),
	message: z.string(),
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
			credential: z.string().optional(),
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
		.refine((text) => [...text].length <= CHAT_ABSOLUTE_MAX_INPUT_CHARACTERS),
})
const bootstrapSendBody = sendBody.extend({ bootstrapSecret: bootstrapSecretSchema })
export const bootstrapIdentityBody = z.object({ requestId: requestIdSchema, bootstrapSecret: bootstrapSecretSchema })
const recoveryBody = bootstrapIdentityBody
const cancelBody = z.object({ generationId: z.string().optional() })
const embedParams = z.object({ embedToken: z.string().openapi({ param: { name: "embedToken", in: "path" } }) })
const commonProblems = problemResponse([
	PROBLEM_CODES.INVALID_REQUEST,
	PROBLEM_CODES.MALFORMED_JSON,
	PROBLEM_CODES.CHAT_CLIENT_ADDRESS_UNAVAILABLE,
	PROBLEM_CODES.CHAT_CONVERSATION_TOO_LONG,
	PROBLEM_CODES.CHAT_DAILY_ALLOWANCE_EXCEEDED,
	PROBLEM_CODES.CHAT_CONCURRENCY_LIMIT,
	PROBLEM_CODES.CHAT_SESSION_BUSY,
	PROBLEM_CODES.CHAT_REQUEST_CONFLICT,
	PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED,
])
const sseResponse = {
	content: { "text/event-stream": { schema: chatEventSchema } },
	description: "Version 1 chat events",
} as const

export const bootstrapSendRoute = createRoute({
	method: "post",
	path: "/{embedToken}/messages",
	operationId: "bootstrapChatMessage",
	tags: ["Conversation"],
	request: {
		params: embedParams,
		body: { required: true, content: { "application/json": { schema: bootstrapSendBody } } },
	},
	responses: {
		200: sseResponse,
		400: commonProblems,
		401: commonProblems,
		409: commonProblems,
		429: commonProblems,
		502: problemResponse([PROBLEM_CODES.PROVIDER_ERROR]),
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})

export const sendRoute = createRoute({
	method: "post",
	path: "/messages",
	operationId: "sendChatMessage",
	tags: ["Conversation"],
	request: { body: { required: true, content: { "application/json": { schema: sendBody } } } },
	responses: {
		200: sseResponse,
		400: commonProblems,
		401: commonProblems,
		409: commonProblems,
		429: commonProblems,
		502: problemResponse([PROBLEM_CODES.PROVIDER_ERROR]),
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})

export const recoverRoute = createRoute({
	method: "post",
	path: "/{embedToken}/bootstrap-recovery",
	operationId: "recoverChatBootstrap",
	tags: ["Conversation"],
	request: { params: embedParams, body: { required: true, content: { "application/json": { schema: recoveryBody } } } },
	responses: {
		200: {
			content: { "application/json": { schema: z.object({ status: z.literal("accepted"), credential: z.string() }) } },
			description: "Recovered credential",
		},
		404: problemResponse([PROBLEM_CODES.CHAT_BOOTSTRAP_NOT_ACCEPTED]),
		401: problemResponse([PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED]),
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})

export const sessionRoute = createRoute({
	method: "get",
	path: "/session",
	operationId: "getChatSession",
	tags: ["Conversation"],
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
	tags: ["Conversation"],
	request: { body: { required: false, content: { "application/json": { schema: cancelBody } } } },
	responses: {
		204: { description: "Cancellation requested" },
		401: problemResponse([PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED]),
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})

export const bootstrapCancelRoute = createRoute({
	method: "post",
	path: "/{embedToken}/bootstrap-cancel",
	operationId: "cancelChatBootstrapGeneration",
	tags: ["Conversation"],
	request: {
		params: embedParams,
		body: { required: true, content: { "application/json": { schema: bootstrapIdentityBody } } },
	},
	responses: {
		204: { description: "Cancellation requested for the accepted bootstrap generation" },
		400: problemResponse([PROBLEM_CODES.INVALID_REQUEST, PROBLEM_CODES.MALFORMED_JSON]),
		401: problemResponse([PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED]),
		404: problemResponse([PROBLEM_CODES.CHAT_BOOTSTRAP_NOT_ACCEPTED]),
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})

export const attemptRoute = createRoute({
	method: "get",
	path: "/attempts/{generationId}",
	operationId: "getChatGeneration",
	tags: ["Conversation"],
	request: {
		params: z.object({ generationId: z.string().openapi({ param: { name: "generationId", in: "path" } }) }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						status: z.enum(["accepted", "running", "completed", "failed", "cancelled", "blocked", "interrupted"]),
						assistantText: z.string(),
					}),
				},
			},
			description: "Persisted generation status",
		},
		401: problemResponse([PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED]),
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})
