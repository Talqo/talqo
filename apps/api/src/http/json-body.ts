import type { Context } from "hono"

import { HTTP_STATUS } from "@/http/status.ts"
import { createMiddleware } from "hono/factory"

export const rejectMalformedJson = createMiddleware(async (context, next) => {
	if (context.req.header("Content-Type")?.startsWith("application/json")) {
		// Empty bodies are valid for bodyless operations whose clients still send the JSON content type.
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

// c.req.json() throws a SyntaxError on malformed bodies; swallow it into `undefined` so
// it flows into the caller's schema.safeParse(...) -> 400 path instead of an uncaught 500.
export async function parseJsonBody(c: Context): Promise<unknown> {
	try {
		return await c.req.json()
	} catch {
		return undefined
	}
}
