import { createRoute, z } from "@hono/zod-openapi"

import { internalServerErrorResponse } from "./openapi.ts"

export const healthResponseSchema = z
	.object({
		status: z.literal("ok"),
	})
	.openapi("HealthResponse")

export const getHealthRoute = createRoute({
	method: "get",
	path: "/health",
	operationId: "getHealth",
	tags: ["Health"],
	responses: {
		200: {
			content: { "application/json": { schema: healthResponseSchema } },
			description: "API is healthy",
		},
		500: internalServerErrorResponse,
	},
})
