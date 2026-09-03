import { HTTP_STATUS } from "@/http/status.ts"
import { createMiddleware } from "hono/factory"

export const rejectMalformedJson = createMiddleware(async (context, next) => {
	if (context.req.header("Content-Type")?.startsWith("application/json")) {
		// Bodyless operations still send the JSON content type, so an empty body is valid.
		if (context.req.header("Content-Length") !== "0") {
			try {
				await context.req.json()
			} catch {
				return context.json({ error: "Malformed JSON body" }, HTTP_STATUS.BAD_REQUEST)
			}
		}
	}

	await next()
})
