import { createRoute, z } from "@hono/zod-openapi"

import { access } from "./access.ts"
import { problemResponse } from "./openapi.ts"
import { PROBLEM_CODES } from "./problem.ts"

const healthResponseSchema = z
	.object({
		status: z.literal("ok"),
	})
	.openapi("HealthResponse")

export const getHealthRoute = createRoute({
	method: "get",
	path: "/health",
	operationId: "getHealth",
	tags: ["Health"],
	...access.public,
	responses: {
		200: {
			content: { "application/json": { schema: healthResponseSchema } },
			description: "API is healthy",
		},
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})
