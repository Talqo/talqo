import { z } from "@hono/zod-openapi"

import type { ProblemCodeSet } from "./problem.ts"

import { PROBLEM_CODES, problemSchema } from "./problem.ts"

// Overridden to OpenAPI's binary string so clients generate an upload field.
export const fileFieldSchema = z
	.custom<File>((value) => value instanceof File)
	.openapi({ type: "string", format: "binary" })

export function problemResponse(codes: ProblemCodeSet) {
	return {
		content: {
			"application/problem+json": {
				schema: problemSchema(),
			},
		},
		description: `Problem response. Codes: ${codes.join(", ")}.`,
	} as const
}

export const payloadTooLargeResponse = problemResponse([PROBLEM_CODES.PAYLOAD_TOO_LARGE])

export const noContentResponse = {
	description: "No content",
} as const

export const sessionSecurity = [{ SessionCookie: [] }]
export const chatBearerSecurity = [{ ChatBearer: [] }]
