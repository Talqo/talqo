import type { AuthedVariables } from "@/http/require-auth.ts"

import { BYTES_PER_MB, env } from "@/config/env.ts"
import { parseJsonBody } from "@/http/json-body.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { Hono } from "hono"
import { extname } from "node:path"
import { z } from "zod"

import {
	contextFileResponseSchema,
	contextFilesResponseSchema,
	createContextResponseSchema,
	renameContextFileRequestSchema,
} from "./context.contract.ts"
import * as files from "./context.files.ts"

// Extension allowlist. The client-declared MIME type is NOT trustworthy for validation:
// browsers label sniffed text content as text/plain regardless of the real type.
const ALLOWED_EXTENSIONS = new Set([".pdf", ".txt", ".md", ".docx"])

class InvalidFileError extends Error {}

function validateNameForDisk(name: string): void {
	try {
		files.validateName(name)
	} catch (error) {
		throw new InvalidFileError((error as Error).message)
	}
}

function validateUpload(file: { name: string; size: number }): void {
	const ext = extname(file.name).toLowerCase()
	if (!ALLOWED_EXTENSIONS.has(ext)) {
		throw new InvalidFileError(`File type ${ext || "(none)"} is not allowed; use PDF, TXT, MD, or DOCX`)
	}
	validateNameForDisk(file.name)
	if (file.size > env.TALQO_MAX_FILE_SIZE_MB * BYTES_PER_MB) {
		throw new InvalidFileError(`File exceeds the ${env.TALQO_MAX_FILE_SIZE_MB} MB size limit`)
	}
}

export const contextRoutes = new Hono<{ Variables: AuthedVariables }>()
	// Any authenticated user can create a context; the UUID is unguessable, which stands
	// in for ownership until the agents module wires a real entity here.
	.post("/api/context", async (c) => {
		const contextId = crypto.randomUUID()
		await files.create(contextId)
		return c.json(createContextResponseSchema.parse({ contextId }), HTTP_STATUS.CREATED)
	})
	.get("/api/context/:contextId/files", async (c) => {
		const contextId = c.req.param("contextId")
		try {
			await files.requireContext(contextId)
		} catch (error) {
			if (error instanceof files.ContextNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
		return c.json(
			contextFilesResponseSchema.parse({
				files: await files.list(contextId),
				maxSizeBytes: env.TALQO_MAX_FILE_SIZE_MB * BYTES_PER_MB,
				maxNameLength: env.TALQO_MAX_FILE_NAME_LENGTH,
			}),
		)
	})
	.post("/api/context/:contextId/files", async (c) => {
		const contextId = c.req.param("contextId")
		const body = await c.req.parseBody()
		const file = body["file"]
		if (!(file instanceof File)) {
			return c.json({ error: "Multipart field 'file' is required" }, HTTP_STATUS.BAD_REQUEST)
		}

		try {
			await files.requireContext(contextId)
			validateUpload(file)
		} catch (error) {
			if (error instanceof files.ContextNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof InvalidFileError) {
				return c.json({ error: error.message }, HTTP_STATUS.BAD_REQUEST)
			}
			throw error
		}
		try {
			const stored = await files.put(contextId, file.name, await file.arrayBuffer())
			return c.json({ file: contextFileResponseSchema.parse(stored) }, HTTP_STATUS.CREATED)
		} catch (error) {
			if (error instanceof files.FileExistsError) {
				return c.json({ error: error.message }, HTTP_STATUS.CONFLICT)
			}
			throw error
		}
	})
	.patch("/api/context/:contextId/files/:fileName", async (c) => {
		const contextId = c.req.param("contextId")
		const name = c.req.param("fileName")
		const body = renameContextFileRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		// URL-decoded before routing: %2F reaches us as a literal "/", so traversal must be rejected here.
		try {
			await files.requireContext(contextId)
			validateNameForDisk(name)
			const trimmed = body.data.name.trim()
			if (!trimmed) throw new InvalidFileError("File name must not be empty")
			const ext = extname(name).toLowerCase()
			const target = trimmed.toLowerCase().endsWith(ext) ? trimmed : `${trimmed}${ext}`
			validateNameForDisk(target)
			const renamed = await files.renameFile(contextId, name, target)
			return c.json({ file: contextFileResponseSchema.parse(renamed) })
		} catch (error) {
			if (error instanceof files.ContextNotFoundError || error instanceof files.FileNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof InvalidFileError) {
				return c.json({ error: error.message }, HTTP_STATUS.BAD_REQUEST)
			}
			if (error instanceof files.FileExistsError) {
				return c.json({ error: error.message }, HTTP_STATUS.CONFLICT)
			}
			throw error
		}
	})
	.delete("/api/context/:contextId/files/:fileName", async (c) => {
		const contextId = c.req.param("contextId")
		const name = c.req.param("fileName")
		try {
			await files.requireContext(contextId)
			// See PATCH: the name is URL-decoded before it reaches us.
			validateNameForDisk(name)
			await files.remove(contextId, name)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			if (error instanceof files.ContextNotFoundError || error instanceof files.FileNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof InvalidFileError) {
				return c.json({ error: error.message }, HTTP_STATUS.BAD_REQUEST)
			}
			throw error
		}
	})
