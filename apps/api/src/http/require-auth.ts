import type { PublicUser } from "@/modules/identity/identity.service.ts"

import * as identity from "@/modules/identity/identity.service.ts"
import { getCookie } from "hono/cookie"
import { createMiddleware } from "hono/factory"

export type AuthedVariables = {
	user: PublicUser
}

const EXEMPT_PATHS = new Set(["/health", "/api/auth/sign-in", "/api/auth/session", "/api/auth/sign-out"])

export const requireAuth = createMiddleware<{ Variables: AuthedVariables }>(async (c, next) => {
	if (EXEMPT_PATHS.has(c.req.path)) {
		return next()
	}

	const token = getCookie(c, "session")
	const session = token ? await identity.getSession(token) : null
	if (!session) {
		return c.json({ error: "Authentication required" }, 401)
	}

	c.set("user", session.user)
	return next()
})
