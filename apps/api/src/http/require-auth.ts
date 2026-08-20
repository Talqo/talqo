import type { PublicUser } from "@/modules/identity/identity.service.ts"

import { HTTP_STATUS } from "@/http/status.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import * as widget from "@/modules/widget/widget.service.ts"
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

// Separate from the exact-match set because the path carries a token segment. Each
// pattern is anchored at both ends by its owning module so it cannot widen to cover
// a sibling route.
const EXEMPT_PATTERNS: readonly RegExp[] = [...widget.PUBLIC_PATH_PATTERNS]

export const requireAuth = createMiddleware<{ Variables: AuthedVariables }>(async (c, next) => {
	if (EXEMPT_PATHS.has(c.req.path) || EXEMPT_PATTERNS.some((pattern) => pattern.test(c.req.path))) {
		return next()
	}

	const token = getCookie(c, identity.SESSION_COOKIE)
	const session = token ? await identity.getSession(token) : null
	if (!session) {
		return c.json({ error: "Authentication required" }, HTTP_STATUS.UNAUTHORIZED)
	}

	// Enforced here, not just by the SPA's redirect, since a direct API call bypasses that gate.
	if (session.user.mustChangePassword && !FORCED_PASSWORD_CHANGE_ALLOWED_PATHS.has(c.req.path)) {
		return c.json({ error: "Password change required" }, HTTP_STATUS.FORBIDDEN)
	}

	c.set("user", session.user)
	return next()
})
