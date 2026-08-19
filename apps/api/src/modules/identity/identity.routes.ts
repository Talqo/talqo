import type { AuthedVariables } from "@/http/require-auth.ts"

import { env } from "@/config/env.ts"
import { parseJsonBody } from "@/http/json-body.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { isUniqueViolation } from "@/lib/pg-error.ts"
import { Hono } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { z } from "zod"

import {
	changePasswordRequestSchema,
	forcedPasswordChangeRequestSchema,
	loginRequestSchema,
	sessionResponseSchema,
	updateAccountRequestSchema,
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

export const identityRoutes = new Hono<{ Variables: AuthedVariables }>()
	.post("/api/auth/login", async (c) => {
		const body = loginRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			const { token, expiresAt, user } = await service.login(body.data)
			setCookie(c, SESSION_COOKIE, token, { ...sessionCookieOptions(), expires: expiresAt })
			return c.json({ user })
		} catch (error) {
			if (error instanceof service.InvalidCredentialsError) {
				return c.json({ error: error.message }, HTTP_STATUS.UNAUTHORIZED)
			}
			throw error
		}
	})
	.post("/api/auth/logout", async (c) => {
		const token = getCookie(c, SESSION_COOKIE)
		if (token) await service.logout(token)
		deleteCookie(c, SESSION_COOKIE, sessionCookieOptions())
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
	.get("/api/auth/session", async (c) => {
		const token = getCookie(c, SESSION_COOKIE)
		const result = token ? await service.getSession(token) : null
		return c.json(sessionResponseSchema.parse({ user: result?.user ?? null }))
	})
	.patch("/api/me", async (c) => {
		const body = updateAccountRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			const user = await service.updateAccount(c.get("user").id, body.data)
			return c.json({ user })
		} catch (error) {
			if (isUniqueViolation(error)) return c.json({ error: "Username already in use" }, HTTP_STATUS.CONFLICT)
			throw error
		}
	})
	.patch("/api/me/password", async (c) => {
		const body = changePasswordRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			await service.changePassword(c.get("user").id, body.data.currentPassword, body.data.newPassword)
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
	.patch("/api/me/password/forced", async (c) => {
		const body = forcedPasswordChangeRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			await service.completeForcedPasswordChange(c.get("user").id, body.data.newPassword)
			// completeForcedPasswordChange invalidates all sessions for the user, including this request's.
			deleteCookie(c, SESSION_COOKIE, sessionCookieOptions())
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			if (error instanceof service.PasswordChangeNotRequiredError) {
				return c.json({ error: error.message }, HTTP_STATUS.CONFLICT)
			}
			throw error
		}
	})
	.delete("/api/me", async (c) => {
		await service.deleteAccount(c.get("user").id)
		deleteCookie(c, SESSION_COOKIE, sessionCookieOptions())
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
