import { access } from "@/http/access.ts"
import { noContentResponse, payloadTooLargeResponse, problemResponse } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { createRoute, z } from "@hono/zod-openapi"

import { MAX_FILE_NAME_LENGTH, MAX_WEBSITE_URL_LENGTH } from "./knowledge-base.service.ts"

const agentFileSchema = z
	.object({
		name: z.string(),
		sizeBytes: z.number().int().nonnegative(),
		createdAt: z.iso.datetime(),
		embeddingStatus: z.enum(["pending", "processing", "ready", "failed"]),
		embeddingError: z.enum(["conversion-failed", "empty-document", "provider-error", "unknown"]).nullable(),
	})
	.openapi("AgentFile")

export const agentFileListResponseSchema = z.object({
	files: z.array(agentFileSchema),
	maxSizeBytes: z.number().int().positive(),
	maxNameLength: z.number().int().positive(),
	allowedExtensions: z.array(z.string()),
})

export const agentFileDetailResponseSchema = z.object({ file: agentFileSchema })

const agentWebsiteSchema = z
	.object({
		id: z.uuid(),
		url: z.string().max(MAX_WEBSITE_URL_LENGTH),
		createdAt: z.iso.datetime(),
		embeddingStatus: z.enum(["pending", "processing", "ready", "failed"]),
		embeddingError: z
			.enum([
				"conversion-failed",
				"empty-document",
				"provider-error",
				"unknown",
				"website-blocked",
				"website-unreachable",
				"website-too-large",
			])
			.nullable(),
	})
	.openapi("AgentWebsite")

export const agentWebsiteListResponseSchema = z.object({
	websites: z.array(agentWebsiteSchema),
	maxPages: z.number().int().positive(),
})

export const agentWebsiteDetailResponseSchema = z.object({ website: agentWebsiteSchema })

const agentParamsSchema = z.object({
	agentId: z.string().openapi({ param: { name: "agentId", in: "path" } }),
})

const fileParamsSchema = z.object({
	agentId: z.string().openapi({ param: { name: "agentId", in: "path" } }),
	fileName: z.string().openapi({ param: { name: "fileName", in: "path" } }),
})

const websiteParamsSchema = z.object({
	agentId: z.string().openapi({ param: { name: "agentId", in: "path" } }),
	websiteId: z.uuid().openapi({ param: { name: "websiteId", in: "path" } }),
})

// Overridden to OpenAPI's binary string so clients generate an upload field.
const fileFieldSchema = z.custom<File>((value) => value instanceof File).openapi({ type: "string", format: "binary" })

// Binary response so generated clients read a Blob instead of parsing JSON.
const fileContentResponseSchema = z
	.custom<Blob>((value) => value instanceof Blob)
	.openapi({
		type: "string",
		format: "binary",
	})

const renameAgentFileRequestSchema = z.object({
	name: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
})

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
const fileNotRetryable = problemResponse([PROBLEM_CODES.AGENT_FILE_NOT_RETRYABLE])
const invalidWebsite = problemResponse([
	PROBLEM_CODES.AGENT_WEBSITE_INVALID,
	PROBLEM_CODES.INVALID_REQUEST,
	PROBLEM_CODES.MALFORMED_JSON,
])
const websiteOrAgentNotFound = problemResponse([PROBLEM_CODES.AGENT_WEBSITE_NOT_FOUND, PROBLEM_CODES.AGENT_NOT_FOUND])
const duplicateWebsite = problemResponse([PROBLEM_CODES.AGENT_WEBSITE_DUPLICATE])
const websiteNotRefreshable = problemResponse([PROBLEM_CODES.AGENT_WEBSITE_NOT_REFRESHABLE])
const serverError = problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR])

export const listAgentFilesRoute = createRoute({
	method: "get",
	path: "/",
	operationId: "listAgentFiles",
	tags: ["Agent"],
	...access.agent(roles.AgentPermission.AgentRead),
	request: { params: agentParamsSchema },
	responses: {
		200: {
			content: { "application/json": { schema: agentFileListResponseSchema } },
			description: "Knowledge files uploaded for the agent",
		},
		401: authRequired,
		403: forbidden,
		404: agentNotFound,
		500: serverError,
	},
})

export const uploadAgentFileRoute = createRoute({
	method: "post",
	path: "/",
	operationId: "uploadAgentFile",
	tags: ["Agent"],
	...access.agent(roles.AgentPermission.AgentManage),
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
		413: payloadTooLargeResponse,
		500: serverError,
	},
})

export const downloadAgentFileRoute = createRoute({
	method: "get",
	path: "/{fileName}",
	operationId: "downloadAgentFile",
	tags: ["Agent"],
	...access.agent(roles.AgentPermission.AgentRead),
	request: { params: fileParamsSchema },
	responses: {
		200: {
			content: { "application/octet-stream": { schema: fileContentResponseSchema } },
			description: "The raw content of the file",
		},
		400: problemResponse([PROBLEM_CODES.AGENT_FILE_INVALID]),
		401: authRequired,
		403: forbidden,
		404: fileOrAgentNotFound,
		500: serverError,
	},
})

export const renameAgentFileRoute = createRoute({
	method: "patch",
	path: "/{fileName}",
	operationId: "renameAgentFile",
	tags: ["Agent"],
	...access.agent(roles.AgentPermission.AgentManage),
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
		413: payloadTooLargeResponse,
		500: serverError,
	},
})

export const deleteAgentFileRoute = createRoute({
	method: "delete",
	path: "/{fileName}",
	operationId: "deleteAgentFile",
	tags: ["Agent"],
	...access.agent(roles.AgentPermission.AgentManage),
	request: { params: fileParamsSchema },
	responses: {
		204: noContentResponse,
		400: problemResponse([PROBLEM_CODES.AGENT_FILE_INVALID]),
		401: authRequired,
		403: forbidden,
		404: fileOrAgentNotFound,
		500: serverError,
	},
})

export const retryAgentFileRoute = createRoute({
	method: "post",
	path: "/{fileName}/retry",
	operationId: "retryAgentFile",
	tags: ["Agent"],
	...access.agent(roles.AgentPermission.AgentManage),
	request: { params: fileParamsSchema },
	responses: {
		204: noContentResponse,
		400: invalidFile,
		401: authRequired,
		403: forbidden,
		404: fileOrAgentNotFound,
		409: fileNotRetryable,
		500: serverError,
	},
})

export const listAgentWebsitesRoute = createRoute({
	method: "get",
	path: "/",
	operationId: "listAgentWebsites",
	tags: ["Agent"],
	...access.agent(roles.AgentPermission.AgentRead),
	request: { params: agentParamsSchema },
	responses: {
		200: {
			content: { "application/json": { schema: agentWebsiteListResponseSchema } },
			description: "Websites added to the agent's knowledge",
		},
		401: authRequired,
		403: forbidden,
		404: agentNotFound,
		500: serverError,
	},
})

export const addAgentWebsiteRoute = createRoute({
	method: "post",
	path: "/",
	operationId: "addAgentWebsite",
	tags: ["Agent"],
	...access.agent(roles.AgentPermission.AgentManage),
	request: {
		params: agentParamsSchema,
		body: {
			content: { "application/json": { schema: z.object({ url: z.string().min(1).max(MAX_WEBSITE_URL_LENGTH) }) } },
			required: true,
		},
	},
	responses: {
		201: {
			content: { "application/json": { schema: agentWebsiteDetailResponseSchema } },
			description: "Website queued for crawling",
		},
		400: invalidWebsite,
		401: authRequired,
		403: forbidden,
		404: agentNotFound,
		409: duplicateWebsite,
		500: serverError,
	},
})

export const refreshAgentWebsiteRoute = createRoute({
	method: "post",
	path: "/{websiteId}/refresh",
	operationId: "refreshAgentWebsite",
	tags: ["Agent"],
	...access.agent(roles.AgentPermission.AgentManage),
	request: { params: websiteParamsSchema },
	responses: {
		204: noContentResponse,
		401: authRequired,
		403: forbidden,
		404: websiteOrAgentNotFound,
		409: websiteNotRefreshable,
		500: serverError,
	},
})

export const deleteAgentWebsiteRoute = createRoute({
	method: "delete",
	path: "/{websiteId}",
	operationId: "deleteAgentWebsite",
	tags: ["Agent"],
	...access.agent(roles.AgentPermission.AgentManage),
	request: { params: websiteParamsSchema },
	responses: {
		204: noContentResponse,
		401: authRequired,
		403: forbidden,
		404: websiteOrAgentNotFound,
		500: serverError,
	},
})
