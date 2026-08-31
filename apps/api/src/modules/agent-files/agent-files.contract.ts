import {
	badRequestResponse,
	conflictResponse,
	forbiddenResponse,
	internalServerErrorResponse,
	noContentResponse,
	notFoundResponse,
	payloadTooLargeResponse,
	sessionSecurity,
	unauthorizedResponse,
} from "@/http/openapi.ts"
import { createRoute, z } from "@hono/zod-openapi"

import { MAX_FILE_NAME_LENGTH } from "./agent-files.service.ts"

export const agentFileSchema = z
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

export const renameAgentFileRequestSchema = z.object({
	name: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
})

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
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		500: internalServerErrorResponse,
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
		400: badRequestResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		409: conflictResponse,
		413: payloadTooLargeResponse,
		500: internalServerErrorResponse,
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
		400: badRequestResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		409: conflictResponse,
		500: internalServerErrorResponse,
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
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		500: internalServerErrorResponse,
	},
})
