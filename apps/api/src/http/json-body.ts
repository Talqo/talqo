import { HTTP_STATUS } from "@/http/status.ts"
import { bodyLimit } from "hono/body-limit"
import { createMiddleware } from "hono/factory"

// Hard ceiling for inbound bodies; generous for the largest payload (system prompts up to 20k chars).
const REQUEST_BODY_MAX_BYTES = 65_536

export const rejectOversizedBody = bodyLimit({
	maxSize: REQUEST_BODY_MAX_BYTES,
	onError: (context) => context.json({ error: "Request body too large" }, HTTP_STATUS.PAYLOAD_TOO_LARGE),
})

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
