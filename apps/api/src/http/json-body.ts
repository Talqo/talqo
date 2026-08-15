import type { Context } from "hono"

// c.req.json() throws a SyntaxError on malformed bodies; swallow it into `undefined` so
// it flows into the caller's schema.safeParse(...) -> 400 path instead of an uncaught 500.
export async function parseJsonBody(c: Context): Promise<unknown> {
	try {
		return await c.req.json()
	} catch {
		return undefined
	}
}
