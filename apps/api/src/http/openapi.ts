import { z } from "@hono/zod-openapi"

const errorResponseSchema = z
	.object({
		error: z.string(),
	})
	.openapi("ErrorResponse")

function errorResponse(description: string) {
	return {
		content: {
			"application/json": {
				schema: errorResponseSchema,
			},
		},
		description,
	} as const
}

export const badRequestResponse = errorResponse("Invalid request")
export const unauthorizedResponse = errorResponse("Authentication required")
export const forbiddenResponse = errorResponse("Permission denied")
export const notFoundResponse = errorResponse("Resource not found")
export const conflictResponse = errorResponse("Request conflicts with current state")
export const internalServerErrorResponse = errorResponse("Unexpected server error")

export const noContentResponse = {
	description: "No content",
} as const

export const sessionSecurity = [{ SessionCookie: [] }]
