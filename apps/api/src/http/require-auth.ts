import type { PublicUser } from "@/modules/identity/identity.service.ts"

import * as identity from "@/modules/identity/identity.service.ts"
import { getCookie } from "hono/cookie"
import { createMiddleware } from "hono/factory"

export type AuthedVariables = {
	user: PublicUser
}

const EXEMPT_PATHS = new Set(["/health", ...identity.PUBLIC_AUTH_PATHS])

export const requireAuth = createMiddleware<{ Variables: AuthedVariables }>(async (c, next) => {
	if (EXEMPT_PATHS.has(c.req.path)) {
		return next()
	}

	const token = getCookie(c, identity.SESSION_COOKIE)
	const session = token ? await identity.getSession(token) : null
	if (!session) {
		return c.json({ error: "Authentication required" }, 401)
	}

	c.set("user", session.user)
	return next()
})
