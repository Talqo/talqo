import { HTTP_STATUS } from "@/http/status.ts"
import { createMiddleware } from "hono/factory"

export const rejectMalformedJson = createMiddleware(async (context, next) => {
	if (context.req.header("Content-Type")?.startsWith("application/json")) {
		try {
			await context.req.json()
		} catch {
			return context.json({ error: "Malformed JSON body" }, HTTP_STATUS.BAD_REQUEST)
		}
	}

	await next()
})
