import { MAX_CHAT_INPUT_CHARACTERS } from "@/config/env.ts"
import { access } from "@/http/access.ts"
import { payloadTooLargeResponse, problemResponse } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import { createRoute, z } from "@hono/zod-openapi"

import { CLIENT_TOOL_LIMIT, MANIFEST_BYTES, TOOL_DESCRIPTION_CHARACTERS } from "./conversation.client-tools.ts"
import { CONVERSATION_AGENT_FILTER_MAX, CONVERSATION_PAGE_MAX } from "./conversation.service.ts"

const requestIdSchema = z.uuid({ version: "v4" })
const TOOL_CALL_ID_CHARACTERS = 256

const toolMetadataSchema = z.object({
	source: z.enum(["client", "mcp"]),
	displayName: z.string(),
	serverName: z.string().optional(),
	outcome: z.enum(["completed", "failed", "cancelled", "interrupted"]).optional(),
})
const toolPartFields = {
	type: z.literal("dynamic-tool"),
	toolName: z.string(),
	toolCallId: z.string(),
	input: z.unknown(),
	toolMetadata: toolMetadataSchema,
}
export const messagePartSchema = z
	.union([
		z.object({ type: z.literal("text"), text: z.string() }),
		z.object({ type: z.literal("step-start") }),
		z.object({ ...toolPartFields, state: z.literal("input-available") }),
		z.object({ ...toolPartFields, state: z.literal("output-available"), output: z.unknown() }),
		z.object({ ...toolPartFields, state: z.literal("output-error"), errorText: z.string() }),
	])
	.openapi("MessagePart")

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
			type: z.literal("part"),
			assistantMessageId: z.string(),
			index: z.number().int().nonnegative(),
			part: messagePartSchema,
		}),
		z.object({
			version: z.literal(1),
			type: z.literal("accepted"),
			requestId: requestIdSchema,
			duplicate: z.boolean().optional(),
			generationId: z.string(),
			userMessage: z.object({ id: z.string(), createdAt: z.iso.datetime() }),
			assistantMessage: z.object({ id: z.string(), createdAt: z.iso.datetime() }),
		}),
		z.object({
			version: z.literal(1),
			type: z.literal("delta"),
			assistantMessageId: z.string(),
			index: z.number().int().nonnegative(),
			text: z.string(),
		}),
		z.object({ version: z.literal(1), type: z.literal("terminal"), outcome: terminalOutcome }),
		z.object({
			version: z.literal(1),
			type: z.literal("tool-start"),
			serverName: z.string(),
			toolName: z.string(),
		}),
		z.object({
			version: z.literal(1),
			type: z.literal("tool-end"),
			serverName: z.string(),
			toolName: z.string(),
			outcome: z.enum(["completed", "failed", "cancelled"]),
		}),
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
	requestId: requestIdSchema.optional(),
	id: z.string(),
	role: z.enum(["user", "assistant"]),
	text: z.string(),
	parts: z.array(messagePartSchema),
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
		.refine((text) => Array.from(text).length <= MAX_CHAT_INPUT_CHARACTERS),
})
const cancelBody = z.object({ generationId: z.uuid({ version: "v4" }).optional() })
const embedParams = z.object({ embedToken: z.string().openapi({ param: { name: "embedToken", in: "path" } }) })
export const clientToolManifestSchema = z
	.array(
		z.strictObject({
			name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
			description: z
				.string()
				.refine((value) => Array.from(value).length <= TOOL_DESCRIPTION_CHARACTERS)
				.optional(),
			inputSchema: z.record(z.string(), z.unknown()),
			outputSchema: z.record(z.string(), z.unknown()).optional(),
			strict: z.boolean().optional(),
			inputExamples: z.array(z.object({ input: z.unknown() })).optional(),
		}),
	)
	.max(CLIENT_TOOL_LIMIT)
	.refine((tools) => new Set(tools.map((tool) => tool.name)).size === tools.length)
	.refine((tools) => Buffer.byteLength(JSON.stringify(tools)) <= MANIFEST_BYTES)
	.openapi("ClientToolManifest")
export const chatClientFrameSchema = z
	.discriminatedUnion("type", [
		z.strictObject({
			version: z.literal(1),
			type: z.literal("start"),
			credential: z.uuid(),
			...sendBody.shape,
			tools: clientToolManifestSchema,
		}),
		z
			.strictObject({
				version: z.literal(1),
				type: z.literal("tool-result"),
				toolCallId: z.string().max(TOOL_CALL_ID_CHARACTERS),
				output: z.unknown(),
			})
			.refine((value) => Object.hasOwn(value, "output")),
		z.strictObject({
			version: z.literal(1),
			type: z.literal("tool-error"),
			toolCallId: z.string().max(TOOL_CALL_ID_CHARACTERS),
			error: z.string().max(TOOL_DESCRIPTION_CHARACTERS),
		}),
		z.strictObject({ version: z.literal(1), type: z.literal("cancel") }),
	])
	.openapi("ChatClientFrameV1")
export const chatServerFrameSchema = z
	.union([
		chatEventSchema,
		z.object({
			version: z.literal(1),
			type: z.literal("tool-call"),
			toolCallId: z.string(),
			toolName: z.string(),
			input: z.unknown(),
			messages: z.array(z.object({ role: z.enum(["user", "assistant", "tool"]), content: z.unknown() })),
		}),
		z.object({
			version: z.literal(1),
			type: z.literal("rejected"),
			code: z.string(),
			status: z.number(),
			retryAt: z.string().optional(),
		}),
	])
	.openapi("ChatServerFrameV1")
export const socketRoute = createRoute({
	method: "get",
	path: "/{embedToken}/socket",
	operationId: "openChatSocket",
	tags: ["Public Chat"],
	...access.public,
	request: { params: embedParams },
	responses: {
		101: { description: "WebSocket upgrade. Authenticate with the first start frame." },
		400: { description: "Invalid upgrade" },
	},
	"x-websocket": {
		clientMessage: { $ref: "#/components/schemas/ChatClientFrameV1" },
		serverMessage: { $ref: "#/components/schemas/ChatServerFrameV1" },
	},
})
const badRequestProblems = problemResponse([
	PROBLEM_CODES.INVALID_REQUEST,
	PROBLEM_CODES.MALFORMED_JSON,
	PROBLEM_CODES.CHAT_CLIENT_ADDRESS_UNAVAILABLE,
	PROBLEM_CODES.CHAT_CONVERSATION_TOO_LONG,
])
const unauthorizedProblem = problemResponse([PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED])
const forbiddenProblem = problemResponse([PROBLEM_CODES.EMBED_DISABLED])
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
	...access.chatBearer,
	request: {
		params: embedParams,
		body: { required: true, content: { "application/json": { schema: sendBody } } },
	},
	responses: {
		200: sseResponse,
		400: badRequestProblems,
		401: unauthorizedProblem,
		403: forbiddenProblem,
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
	...access.chatBearer,
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
	...access.chatBearer,
	request: { body: { required: false, content: { "application/json": { schema: cancelBody } } } },
	responses: {
		204: { description: "Cancellation requested" },
		401: problemResponse([PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED]),
		413: payloadTooLargeResponse,
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})

const transcriptMessageSchema = messageSchema.openapi("ConversationMessage")
export const conversationListResponseSchema = z
	.object({
		conversations: z.array(
			z
				.object({
					id: z.string(),
					agentId: z.string(),
					startedAt: z.iso.datetime(),
					messageCount: z.number().int().nonnegative(),
					preview: z.string().nullable(),
				})
				.openapi("ConversationSummary"),
		),
		page: z.number().int().positive(),
		pageSize: z.number().int().positive(),
		total: z.number().int().nonnegative(),
	})
	.openapi("ConversationList")
export const conversationTranscriptResponseSchema = z
	.object({
		conversation: z
			.object({
				id: z.string(),
				agentId: z.string(),
				startedAt: z.iso.datetime(),
				messages: z.array(transcriptMessageSchema),
			})
			.openapi("ConversationTranscript"),
	})
	.openapi("ConversationTranscriptResponse")

const listConversationsQuery = z.object({
	agentId: z
		.preprocess(
			(value) => (value === undefined || Array.isArray(value) ? value : [value]),
			z.array(z.uuid()).max(CONVERSATION_AGENT_FILTER_MAX).optional(),
		)
		.openapi({ param: { name: "agentId", in: "query", style: "form", explode: true } }),
	page: z.coerce
		.number()
		.int()
		.min(1)
		.max(CONVERSATION_PAGE_MAX)
		.default(1)
		.openapi({ param: { name: "page", in: "query" } }),
})
const transcriptParams = z.object({
	conversationId: z.uuid().openapi({ param: { name: "conversationId", in: "path" } }),
})
const operatorAuthRequired = problemResponse([PROBLEM_CODES.AUTHENTICATION_REQUIRED])
const operatorForbidden = problemResponse([PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED, PROBLEM_CODES.PERMISSION_DENIED])
const operatorServerError = problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR])

export const listConversationsRoute = createRoute({
	method: "get",
	path: "/",
	operationId: "listConversations",
	tags: ["Conversation"],
	...access.session(),
	request: { query: listConversationsQuery },
	responses: {
		200: {
			content: { "application/json": { schema: conversationListResponseSchema } },
			description: "One page of conversations across agents, newest first",
		},
		400: problemResponse([PROBLEM_CODES.INVALID_REQUEST]),
		401: operatorAuthRequired,
		403: operatorForbidden,
		500: operatorServerError,
	},
})

export const getConversationRoute = createRoute({
	method: "get",
	path: "/{conversationId}",
	operationId: "getConversation",
	tags: ["Conversation"],
	...access.session(),
	request: { params: transcriptParams },
	responses: {
		200: {
			content: { "application/json": { schema: conversationTranscriptResponseSchema } },
			description: "Full conversation transcript",
		},
		400: problemResponse([PROBLEM_CODES.INVALID_REQUEST]),
		401: operatorAuthRequired,
		403: operatorForbidden,
		404: problemResponse([PROBLEM_CODES.CONVERSATION_NOT_FOUND]),
		500: operatorServerError,
	},
})
