import type { AuthedVariables } from "@/http/require-auth.ts"

import { env } from "@/config/env.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { isUniqueViolation } from "@/lib/pg-error.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"

import {
	changePasswordRoute,
	deleteAccountRoute,
	getSessionRoute,
	loginRoute,
	logoutRoute,
	sessionResponseSchema,
	updateAccountRoute,
} from "./identity.contract.ts"
import * as service from "./identity.service.ts"

const { SESSION_COOKIE } = service

function sessionCookieOptions() {
	return {
		httpOnly: true,
		sameSite: "Lax" as const,
		secure: env.NODE_ENV === "production",
		path: "/",
	}
}

const authRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(loginRoute, async (c) => {
		try {
			const { token, expiresAt, user } = await service.login(c.req.valid("json"))
			setCookie(c, SESSION_COOKIE, token, { ...sessionCookieOptions(), expires: expiresAt })
			return c.json({ user }, HTTP_STATUS.OK)
		} catch (error) {
			if (error instanceof service.InvalidCredentialsError) {
				return c.json({ error: error.message }, HTTP_STATUS.UNAUTHORIZED)
			}
			throw error
		}
	})
	.openapi(logoutRoute, async (c) => {
		const token = getCookie(c, SESSION_COOKIE)
		if (token) await service.logout(token)
		deleteCookie(c, SESSION_COOKIE, sessionCookieOptions())
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
	.openapi(getSessionRoute, async (c) => {
		const token = getCookie(c, SESSION_COOKIE)
		const result = token ? await service.getSession(token) : null
		return c.json(sessionResponseSchema.parse({ user: result?.user ?? null }), HTTP_STATUS.OK)
	})

const accountRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(updateAccountRoute, async (c) => {
		try {
			const user = await service.updateAccount(c.get("user").id, c.req.valid("json"))
			return c.json({ user }, HTTP_STATUS.OK)
		} catch (error) {
			if (isUniqueViolation(error)) return c.json({ error: "Username already in use" }, HTTP_STATUS.CONFLICT)
			throw error
		}
	})
	.openapi(changePasswordRoute, async (c) => {
		const body = c.req.valid("json")
		try {
			await service.changePassword(c.get("user").id, body.currentPassword, body.newPassword)
			// changePassword invalidates all sessions for the user, including this request's.
			deleteCookie(c, SESSION_COOKIE, sessionCookieOptions())
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			if (error instanceof service.InvalidPasswordError) {
				return c.json({ error: error.message }, HTTP_STATUS.BAD_REQUEST)
			}
			throw error
		}
	})
	.openapi(deleteAccountRoute, async (c) => {
		await service.deleteAccount(c.get("user").id)
		deleteCookie(c, SESSION_COOKIE, sessionCookieOptions())
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})

export const identityRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
identityRoutes.route("/auth", authRoutes)
identityRoutes.route("/me", accountRoutes)
