import { z } from "zod"

import { MAX_FILE_NAME_LENGTH } from "./context.service.ts"

// TODO: this module is a stub owned by the context-file-upload task. When the agents
// module lands, its entities become the namespace for these uploads; the directory
// layout (<uploadDir>/<contextId>/) already matches that future shape, so the
// migration is path-segment relabeling, not a schema change.
export const createContextResponseSchema = z.object({
	contextId: z.string(),
})

export const contextFileResponseSchema = z.object({
	// The name doubles as the id: files are unique per context directory and have no database row.
	name: z.string(),
	sizeBytes: z.number().int().nonnegative(),
	createdAt: z.date(),
})

export const contextFilesResponseSchema = z.object({
	files: z.array(contextFileResponseSchema),
	maxSizeBytes: z.number().int().positive(),
	maxNameLength: z.number().int().positive(),
})

export const renameContextFileRequestSchema = z.object({
	name: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
})
