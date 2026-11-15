import type { PublicUser } from "@/modules/identity/identity.service.ts"
import type { BlankEnv, Env, MiddlewareHandler } from "hono/types"

import { chatBearerSecurity, sessionSecurity } from "@/http/openapi.ts"
import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { hasMatchedRoute } from "@/http/route-match.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { annotate } from "@/http/wide-event.ts"
import * as agents from "@/modules/agent/agent.service.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { getCookie } from "hono/cookie"
import { createMiddleware } from "hono/factory"
import { matchedRoutes } from "hono/route"
import { z } from "zod"

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

const allowPublic = policy(
	createMiddleware<BlankEnv>(async (c, next) => {
		annotate(c, { "auth.kind": "public" })
		return next()
	}),
)

type SessionOptions = {
	allowPendingPasswordChange?: boolean
	permission?: roles.Permission
	agentPermission?: roles.AgentPermission
}

async function requireAgentAccess(
	userId: string,
	agentId: string | undefined,
	permission: roles.AgentPermission | undefined,
): Promise<typeof PROBLEM_CODES.INVALID_REQUEST | undefined> {
	if (agentId && !z.uuid().safeParse(agentId).success) return PROBLEM_CODES.INVALID_REQUEST
	if (permission) {
		if (agentId) await roles.requireAgentPermission(userId, agentId, permission)
		else await roles.requireAgentScope(userId, permission)
	}
	if (agentId) await agents.getAgent(agentId)
	return undefined
}

async function requireSessionPermissions(
	userId: string,
	agentId: string | undefined,
	options: SessionOptions,
): Promise<typeof PROBLEM_CODES.PERMISSION_DENIED | typeof PROBLEM_CODES.INVALID_REQUEST | undefined> {
	if (options.permission) {
		const held = await roles.listEffectivePermissions(userId)
		if (!held.includes(options.permission)) return PROBLEM_CODES.PERMISSION_DENIED
	}
	return requireAgentAccess(userId, agentId, options.agentPermission)
}

function requireSession(options: SessionOptions) {
	return policy(
		createMiddleware<{ Variables: { user: PublicUser } }>(async (c, next) => {
			annotate(c, { "auth.kind": "session" })
			const token = getCookie(c, identity.SESSION_COOKIE)
			const session = token ? await identity.getSession(token) : null
			if (!session) {
				return problemResponse(c, PROBLEM_CODES.AUTHENTICATION_REQUIRED, HTTP_STATUS.UNAUTHORIZED)
			}
			annotate(c, { "user.id": session.user.id })

			// Enforced here too: a direct API call bypasses the SPA's redirect.
			if (session.user.mustChangePassword && !options.allowPendingPasswordChange) {
				return problemResponse(c, PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED, HTTP_STATUS.FORBIDDEN)
			}

			const denied = await requireSessionPermissions(session.user.id, c.req.param("agentId"), options)
			if (denied) {
				const status = denied === PROBLEM_CODES.INVALID_REQUEST ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.FORBIDDEN
				return problemResponse(c, denied, status)
			}

			c.set("user", session.user)
			return next()
		}),
	)
}

type SessionAccess = { middleware: ReturnType<typeof requireSession>; security: typeof sessionSecurity }

function permissionAccess(permission: roles.Permission): SessionAccess {
	return {
		security: sessionSecurity,
		middleware: requireSession({ permission }),
	}
}

// Only extracts the credential; the conversation service decides whether it is valid.
const requireChatBearer = policy(
	createMiddleware<{ Variables: { chatCredential: string } }>(async (c, next) => {
		annotate(c, { "auth.kind": "chat_bearer" })
		const credential = /^Bearer ([^\s]+)$/.exec(c.req.header("authorization") ?? "")?.[1]
		if (!credential) {
			return problemResponse(c, PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED)
		}
		c.set("chatCredential", credential)
		return next()
	}),
)

export const access = {
	public: { security: [], middleware: allowPublic },
	// Only the password-change routes pass allowPendingPasswordChange: they clear the flag.
	session: (options: { allowPendingPasswordChange?: boolean } = {}) => ({
		security: sessionSecurity,
		middleware: requireSession(options),
	}),
	permission: permissionAccess,
	agent: (permission: roles.AgentPermission): SessionAccess => ({
		security: sessionSecurity,
		middleware: requireSession({ agentPermission: permission }),
	}),
	chatBearer: { security: chatBearerSecurity, middleware: requireChatBearer },
}

export const requireAccessPolicy = createMiddleware(async (c, next) => {
	if (!hasMatchedRoute(c)) return next()
	if (matchedRoutes(c).some((route) => isAccessPolicy(route.handler))) return next()

	console.error("route.access_policy_missing", { method: c.req.method, path: c.req.path })
	return problemResponse(c, PROBLEM_CODES.INTERNAL_SERVER_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR)
})
