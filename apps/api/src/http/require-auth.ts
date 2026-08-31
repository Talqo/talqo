import type { PublicUser } from "@/modules/identity/identity.service.ts"

import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { hasMatchedRoute } from "@/http/route-match.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { getCookie } from "hono/cookie"
import { createMiddleware } from "hono/factory"

export type AuthedVariables = {
	user: PublicUser
}

export const API_PREFIX = "/api"

const EXEMPT_PATHS = new Set([
	"/health",
	...identity.PUBLIC_AUTH_PATHS.map((path) => API_PREFIX + path),
	...roles.PUBLIC_PATHS.map((path) => API_PREFIX + path),
])

// Both routes correctly clear mustChangePassword as part of rotating the password.
const FORCED_PASSWORD_CHANGE_ALLOWED_PATHS = new Set([`${API_PREFIX}/me/password`, `${API_PREFIX}/me/password/forced`])

export const requireAuth = createMiddleware<{ Variables: AuthedVariables }>(async (c, next) => {
	if (!hasMatchedRoute(c)) return next()

	if (EXEMPT_PATHS.has(c.req.path)) {
		return next()
	}

	const token = getCookie(c, identity.SESSION_COOKIE)
	const session = token ? await identity.getSession(token) : null
	if (!session) {
		return problemResponse(c, PROBLEM_CODES.AUTHENTICATION_REQUIRED, HTTP_STATUS.UNAUTHORIZED)
	}

	// Enforced here, not just by the SPA's redirect, since a direct API call bypasses that gate.
	if (session.user.mustChangePassword && !FORCED_PASSWORD_CHANGE_ALLOWED_PATHS.has(c.req.path)) {
		return problemResponse(c, PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED, HTTP_STATUS.FORBIDDEN)
	}

	c.set("user", session.user)
	return next()
})

export const requireAdmin = createMiddleware<{ Variables: AuthedVariables }>(async (c, next) => {
	if (!(await roles.isAdmin(c.get("user").id))) {
		return problemResponse(c, PROBLEM_CODES.ADMIN_ACCESS_REQUIRED, HTTP_STATUS.FORBIDDEN)
	}
	return next()
})
