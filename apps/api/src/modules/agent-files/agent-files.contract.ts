import { noContentResponse, problemResponse, sessionSecurity } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import { createRoute, z } from "@hono/zod-openapi"

import { MAX_FILE_NAME_LENGTH } from "./agent-files.service.ts"

const agentFileSchema = z
	.object({
		name: z.string(),
		sizeBytes: z.number().int().nonnegative(),
		createdAt: z.iso.datetime(),
	})
	.openapi("AgentFile")

export const agentFileListResponseSchema = z.object({
	files: z.array(agentFileSchema),
	maxSizeBytes: z.number().int().positive(),
	maxNameLength: z.number().int().positive(),
	allowedExtensions: z.array(z.string()),
})

export const agentFileDetailResponseSchema = z.object({ file: agentFileSchema })

const agentParamsSchema = z.object({
	agentId: z.string().openapi({ param: { name: "agentId", in: "path" } }),
})

const fileParamsSchema = z.object({
	agentId: z.string().openapi({ param: { name: "agentId", in: "path" } }),
	fileName: z.string().openapi({ param: { name: "fileName", in: "path" } }),
})

// Overridden to OpenAPI's binary string so clients generate an upload field.
const fileFieldSchema = z.custom<File>((value) => value instanceof File).openapi({ type: "string", format: "binary" })

const renameAgentFileRequestSchema = z.object({
	name: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
})

const malformedJson = problemResponse([PROBLEM_CODES.MALFORMED_JSON])
const invalidFile = problemResponse([
	PROBLEM_CODES.AGENT_FILE_INVALID,
	PROBLEM_CODES.INVALID_REQUEST,
	PROBLEM_CODES.MALFORMED_JSON,
])
const authRequired = problemResponse([PROBLEM_CODES.AUTHENTICATION_REQUIRED])
const forbidden = problemResponse([PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED, PROBLEM_CODES.PERMISSION_DENIED])
const agentNotFound = problemResponse([PROBLEM_CODES.AGENT_NOT_FOUND])
const fileOrAgentNotFound = problemResponse([PROBLEM_CODES.AGENT_FILE_NOT_FOUND, PROBLEM_CODES.AGENT_NOT_FOUND])
const fileNameTaken = problemResponse([PROBLEM_CODES.AGENT_FILE_NAME_TAKEN])
const payloadTooLarge = problemResponse([PROBLEM_CODES.PAYLOAD_TOO_LARGE])
const serverError = problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR])

export const listAgentFilesRoute = createRoute({
	method: "get",
	path: "/{agentId}/files",
	operationId: "listAgentFiles",
	tags: ["Agent"],
	security: sessionSecurity,
	request: { params: agentParamsSchema },
	responses: {
		200: {
			content: { "application/json": { schema: agentFileListResponseSchema } },
			description: "Knowledge files uploaded for the agent",
		},
		400: malformedJson,
		401: authRequired,
		403: forbidden,
		404: agentNotFound,
		500: serverError,
	},
})

export const uploadAgentFileRoute = createRoute({
	method: "post",
	path: "/{agentId}/files",
	operationId: "uploadAgentFile",
	tags: ["Agent"],
	security: sessionSecurity,
	request: {
		params: agentParamsSchema,
		body: {
			content: { "multipart/form-data": { schema: z.object({ file: fileFieldSchema }) } },
			required: true,
		},
	},
	responses: {
		201: { content: { "application/json": { schema: agentFileDetailResponseSchema } }, description: "File uploaded" },
		400: invalidFile,
		401: authRequired,
		403: forbidden,
		404: agentNotFound,
		409: fileNameTaken,
		413: payloadTooLarge,
		500: serverError,
	},
})

export const renameAgentFileRoute = createRoute({
	method: "patch",
	path: "/{agentId}/files/{fileName}",
	operationId: "renameAgentFile",
	tags: ["Agent"],
	security: sessionSecurity,
	request: {
		params: fileParamsSchema,
		body: { content: { "application/json": { schema: renameAgentFileRequestSchema } }, required: true },
	},
	responses: {
		200: { content: { "application/json": { schema: agentFileDetailResponseSchema } }, description: "File renamed" },
		400: invalidFile,
		401: authRequired,
		403: forbidden,
		404: fileOrAgentNotFound,
		409: fileNameTaken,
		500: serverError,
	},
})

export const deleteAgentFileRoute = createRoute({
	method: "delete",
	path: "/{agentId}/files/{fileName}",
	operationId: "deleteAgentFile",
	tags: ["Agent"],
	security: sessionSecurity,
	request: { params: fileParamsSchema },
	responses: {
		204: noContentResponse,
		400: problemResponse([PROBLEM_CODES.AGENT_FILE_INVALID, PROBLEM_CODES.MALFORMED_JSON]),
		401: authRequired,
		403: forbidden,
		404: fileOrAgentNotFound,
		500: serverError,
	},
})
