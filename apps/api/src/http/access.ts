import type { PublicUser } from "@/modules/identity/identity.service.ts"
import type { BlankEnv, Env, MiddlewareHandler } from "hono/types"

import { chatBearerSecurity, sessionSecurity } from "@/http/openapi.ts"
import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { hasMatchedRoute } from "@/http/route-match.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { getCookie } from "hono/cookie"
import { createMiddleware } from "hono/factory"
import { matchedRoutes } from "hono/route"

// Each contract spreads one `access.*` entry, which sets both its OpenAPI `security` and its
// enforcement. `requireAccessPolicy` refuses any matched route without one, so access fails closed.
const policies = new WeakSet<MiddlewareHandler>()

function policy<E extends Env>(handler: MiddlewareHandler<E>): MiddlewareHandler<E> {
	policies.add(handler as MiddlewareHandler)
	return handler
}

export function isAccessPolicy(handler: unknown): boolean {
	return typeof handler === "function" && policies.has(handler as MiddlewareHandler)
}

export const allowPublic = policy(createMiddleware<BlankEnv>(async (_c, next) => next()))

type SessionOptions = { allowPendingPasswordChange?: boolean; permission?: roles.Permission }

function requireSession(options: SessionOptions) {
	return policy(
		createMiddleware<{ Variables: { user: PublicUser } }>(async (c, next) => {
			const token = getCookie(c, identity.SESSION_COOKIE)
			const session = token ? await identity.getSession(token) : null
			if (!session) {
				return problemResponse(c, PROBLEM_CODES.AUTHENTICATION_REQUIRED, HTTP_STATUS.UNAUTHORIZED)
			}

			// Enforced here too: a direct API call bypasses the SPA's redirect.
			if (session.user.mustChangePassword && !options.allowPendingPasswordChange) {
				return problemResponse(c, PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED, HTTP_STATUS.FORBIDDEN)
			}

			if (options.permission && !(await roles.authorize(session.user.id, options.permission))) {
				const code =
					options.permission === roles.Permission.Admin
						? PROBLEM_CODES.ADMIN_ACCESS_REQUIRED
						: PROBLEM_CODES.PERMISSION_DENIED
				return problemResponse(c, code, HTTP_STATUS.FORBIDDEN)
			}

			c.set("user", session.user)
			return next()
		}),
	)
}

// Only extracts the credential; the conversation service decides whether it is valid.
const requireChatBearer = policy(
	createMiddleware<{ Variables: { chatCredential: string } }>(async (c, next) => {
		const credential = /^Bearer ([^\s]+)$/.exec(c.req.header("authorization") ?? "")?.[1]
		if (!credential) {
			return problemResponse(c, PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED)
		}
		c.set("chatCredential", credential)
		return next()
	}),
)

export const access = {
	public: { middleware: allowPublic },
	// Only the password-change routes pass allowPendingPasswordChange: they clear the flag.
	session: (options: { allowPendingPasswordChange?: boolean } = {}) => ({
		security: sessionSecurity,
		middleware: requireSession(options),
	}),
	permission: (permission: roles.Permission) => ({
		security: sessionSecurity,
		middleware: requireSession({ permission }),
	}),
	chatBearer: { security: chatBearerSecurity, middleware: requireChatBearer },
}

export const requireAccessPolicy = createMiddleware(async (c, next) => {
	if (!hasMatchedRoute(c)) return next()
	if (matchedRoutes(c).some((route) => isAccessPolicy(route.handler))) return next()

	console.error("route.access_policy_missing", { method: c.req.method, path: c.req.path })
	return problemResponse(c, PROBLEM_CODES.INTERNAL_SERVER_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR)
})
