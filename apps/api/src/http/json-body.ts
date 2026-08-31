import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { hasMatchedRoute } from "@/http/route-match.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { createMiddleware } from "hono/factory"

export const rejectMalformedJson = createMiddleware(async (context, next) => {
	if (!hasMatchedRoute(context)) return next()

	if (context.req.header("Content-Type")?.startsWith("application/json")) {
		// Empty bodies are valid for bodyless operations whose clients still send the JSON content type.
		if (context.req.header("Content-Length") !== "0") {
			try {
				await context.req.json()
			} catch {
				return problemResponse(context, PROBLEM_CODES.MALFORMED_JSON, HTTP_STATUS.BAD_REQUEST)
			}
		}
	}

	await next()
})
