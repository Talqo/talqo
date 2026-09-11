import type { AuthedVariables } from "@/http/require-auth.ts"

import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { bodyLimit } from "hono/body-limit"

import {
	agentFileDetailResponseSchema,
	agentFileListResponseSchema,
	deleteAgentFileRoute,
	listAgentFilesRoute,
	renameAgentFileRoute,
	uploadAgentFileRoute,
} from "./agent-files.contract.ts"
import * as files from "./agent-files.service.ts"

function serialize(file: files.StoredFile) {
	return { ...file, createdAt: file.createdAt.toISOString() }
}

async function requireAgent(agentId: string): Promise<void> {
	await agent.getAgent(agentId)
}

const uploadBodyLimit = bodyLimit({
	maxSize: files.MAX_UPLOAD_BODY_BYTES,
	onError: (c) => problemResponse(c, PROBLEM_CODES.PAYLOAD_TOO_LARGE, HTTP_STATUS.PAYLOAD_TOO_LARGE),
})

const routes = new OpenAPIHono<{ Variables: AuthedVariables }>()
routes.use("/:agentId/files", uploadBodyLimit)

export const agentFilesRoutes = routes
	.openapi(listAgentFilesRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsManage))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}
		const agentId = c.req.valid("param").agentId
		try {
			await requireAgent(agentId)
			return c.json(
				agentFileListResponseSchema.parse({
					files: (await files.list(agentId)).map(serialize),
					maxSizeBytes: files.MAX_FILE_SIZE_BYTES,
					maxNameLength: files.MAX_FILE_NAME_LENGTH,
					allowedExtensions: [...files.ALLOWED_EXTENSIONS],
				}),
				HTTP_STATUS.OK,
			)
		} catch (error) {
			if (error instanceof agent.AgentNotFoundError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.openapi(uploadAgentFileRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsManage))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}
		const agentId = c.req.valid("param").agentId
		const body = c.req.valid("form")
		const file = body["file"]
		if (!(file instanceof File)) {
			return problemResponse(c, PROBLEM_CODES.AGENT_FILE_INVALID, HTTP_STATUS.BAD_REQUEST)
		}
		try {
			await requireAgent(agentId)
			files.validateUpload(file)
			const stored = await files.put(agentId, file.name, await file.arrayBuffer())
			return c.json(agentFileDetailResponseSchema.parse({ file: serialize(stored) }), HTTP_STATUS.CREATED)
		} catch (error) {
			if (error instanceof files.FileTooLargeError) {
				return problemResponse(c, PROBLEM_CODES.PAYLOAD_TOO_LARGE, HTTP_STATUS.PAYLOAD_TOO_LARGE)
			}
			if (error instanceof files.InvalidFileError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_FILE_INVALID, HTTP_STATUS.BAD_REQUEST)
			}
			if (error instanceof agent.AgentNotFoundError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof files.FileExistsError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_FILE_NAME_TAKEN, HTTP_STATUS.CONFLICT)
			}
			throw error
		}
	})
	.openapi(renameAgentFileRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsManage))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}
		const { agentId, fileName } = c.req.valid("param")
		// URL-decoded before routing: %2F reaches us as a literal "/", so traversal must be rejected here.
		try {
			await requireAgent(agentId)
			files.validateName(fileName)
			const target = files.resolveRenameTarget(fileName, c.req.valid("json").name)
			const renamed = await files.renameFile(agentId, fileName, target)
			return c.json(agentFileDetailResponseSchema.parse({ file: serialize(renamed) }), HTTP_STATUS.OK)
		} catch (error) {
			if (error instanceof files.InvalidFileError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_FILE_INVALID, HTTP_STATUS.BAD_REQUEST)
			}
			if (error instanceof agent.AgentNotFoundError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof files.FileNotFoundError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_FILE_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof files.FileExistsError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_FILE_NAME_TAKEN, HTTP_STATUS.CONFLICT)
			}
			throw error
		}
	})
	.openapi(deleteAgentFileRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsManage))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}
		const { agentId, fileName } = c.req.valid("param")
		try {
			await requireAgent(agentId)
			files.validateName(fileName)
			await files.remove(agentId, fileName)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			if (error instanceof files.InvalidFileError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_FILE_INVALID, HTTP_STATUS.BAD_REQUEST)
			}
			if (error instanceof agent.AgentNotFoundError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof files.FileNotFoundError) {
				return problemResponse(c, PROBLEM_CODES.AGENT_FILE_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
