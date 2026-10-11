import type { PublicUser } from "@/modules/identity/identity.service.ts"
import type { z } from "@hono/zod-openapi"
import type { Context } from "hono"
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

const allowPublic = policy(createMiddleware<BlankEnv>(async (_c, next) => next()))

type BodyTarget<B> = {
	body: z.ZodType<B>
	resolve: (request: { body: B; params: Record<string, string> }) => Promise<roles.Permission[]>
}
// A body is read only when declared, so multipart routes stay untouched.
type ParamsTarget = {
	body?: never
	resolve: (request: { params: Record<string, string> }) => Promise<roles.Permission[]>
}
type AccessTarget<B> = BodyTarget<B> | ParamsTarget

// Resolves to undefined when the body fails the declared schema.
function targetResolver<B>(target: AccessTarget<B>): (c: Context) => Promise<roles.Permission[] | undefined> {
	return async (c) => {
		const params = c.req.param()
		if (!target.body) return target.resolve({ params })
		const body = target.body.safeParse(await c.req.json().catch(() => undefined))
		return body.success ? target.resolve({ body: body.data, params }) : undefined
	}
}

type SessionOptions = {
	allowPendingPasswordChange?: boolean
	permission?: roles.Permission
	resolveTarget?: ReturnType<typeof targetResolver>
}

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

			if (options.resolveTarget) {
				const [targeted, held] = await Promise.all([
					options.resolveTarget(c),
					roles.listEffectivePermissions(session.user.id),
				])
				// Fails closed: an unreadable body is rejected, never treated as "no target".
				if (!targeted) return problemResponse(c, PROBLEM_CODES.INVALID_REQUEST, HTTP_STATUS.BAD_REQUEST)
				if (targeted.some((permission) => !held.includes(permission))) {
					return problemResponse(c, PROBLEM_CODES.PERMISSION_EXCEEDS_OWN, HTTP_STATUS.FORBIDDEN)
				}
			}

			c.set("user", session.user)
			return next()
		}),
	)
}

type SessionAccess = { middleware: ReturnType<typeof requireSession>; security: typeof sessionSecurity }

// Overloads, not one union-typed option: TypeScript cannot contextually type `resolve` across a union.
function permissionAccess<B>(permission: roles.Permission, options?: { target: BodyTarget<B> }): SessionAccess
function permissionAccess(permission: roles.Permission, options?: { target: ParamsTarget }): SessionAccess
function permissionAccess<B>(permission: roles.Permission, options: { target?: AccessTarget<B> } = {}): SessionAccess {
	return {
		security: sessionSecurity,
		middleware: requireSession({
			permission,
			resolveTarget: options.target ? targetResolver(options.target) : undefined,
		}),
	}
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
	public: { security: [], middleware: allowPublic },
	// Only the password-change routes pass allowPendingPasswordChange: they clear the flag.
	session: (options: { allowPendingPasswordChange?: boolean } = {}) => ({
		security: sessionSecurity,
		middleware: requireSession(options),
	}),
	permission: permissionAccess,
	chatBearer: { security: chatBearerSecurity, middleware: requireChatBearer },
}

export const requireAccessPolicy = createMiddleware(async (c, next) => {
	if (!hasMatchedRoute(c)) return next()
	if (matchedRoutes(c).some((route) => isAccessPolicy(route.handler))) return next()

	console.error("route.access_policy_missing", { method: c.req.method, path: c.req.path })
	return problemResponse(c, PROBLEM_CODES.INTERNAL_SERVER_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR)
})
