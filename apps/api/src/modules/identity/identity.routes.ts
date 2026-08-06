import type { AuthedVariables } from "@/http/require-auth.ts"
import type { Context } from "hono"

import { env } from "@/config/env.ts"
import { Hono } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { z } from "zod"

import {
	changePasswordRequestSchema,
	sessionResponseSchema,
	signInRequestSchema,
	updateAccountRequestSchema,
} from "./identity.contract.ts"
import * as service from "./identity.service.ts"

const { SESSION_COOKIE } = service

// c.req.json() throws a SyntaxError on malformed bodies; swallow it into `undefined` so
// it flows into the existing schema.safeParse(...) -> 400 path instead of an uncaught 500.
async function parseJsonBody(c: Context): Promise<unknown> {
	try {
		return await c.req.json()
	} catch {
		return undefined
	}
}

function sessionCookieOptions() {
	return {
		httpOnly: true,
		sameSite: "Lax" as const,
		secure: env.NODE_ENV === "production",
		path: "/",
	}
}

function isUniqueViolation(error: unknown): boolean {
	// drizzle-orm wraps the raw Postgres error (with its `code`) in a DrizzleQueryError's
	// `.cause`, so the unique-violation code isn't on the caught error directly.
	let current: unknown = error
	for (let depth = 0; depth < 5 && current; depth += 1) {
		if (typeof current === "object" && "code" in current && current.code === "23505") return true
		current = current instanceof Error ? current.cause : undefined
	}
	return false
}

export const identityRoutes = new Hono<{ Variables: AuthedVariables }>()
	.post("/api/auth/sign-in", async (c) => {
		const body = signInRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)

		try {
			const { token, expiresAt, user } = await service.login(body.data)
			setCookie(c, SESSION_COOKIE, token, { ...sessionCookieOptions(), expires: expiresAt })
			return c.json({ user })
		} catch (error) {
			if (error instanceof service.InvalidCredentialsError) {
				return c.json({ error: error.message }, 401)
			}
			throw error
		}
	})
	.post("/api/auth/sign-out", async (c) => {
		const token = getCookie(c, SESSION_COOKIE)
		if (token) await service.logout(token)
		deleteCookie(c, SESSION_COOKIE, { path: "/" })
		return c.body(null, 204)
	})
	.get("/api/auth/session", async (c) => {
		const token = getCookie(c, SESSION_COOKIE)
		const result = token ? await service.getSession(token) : null
		return c.json(sessionResponseSchema.parse({ user: result?.user ?? null }))
	})
	.patch("/api/me", async (c) => {
		const body = updateAccountRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)

		try {
			const user = await service.updateAccount(c.get("user").id, body.data)
			return c.json({ user })
		} catch (error) {
			if (isUniqueViolation(error)) return c.json({ error: "Username already in use" }, 409)
			throw error
		}
	})
	.patch("/api/me/password", async (c) => {
		const body = changePasswordRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)

		try {
			await service.changePassword(c.get("user").id, body.data.currentPassword, body.data.newPassword)
			// changePassword invalidates all sessions for the user, including this request's.
			deleteCookie(c, SESSION_COOKIE, { path: "/" })
			return c.body(null, 204)
		} catch (error) {
			if (error instanceof service.InvalidPasswordError) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	})
	.delete("/api/me", async (c) => {
		await service.deleteAccount(c.get("user").id)
		deleteCookie(c, SESSION_COOKIE, { path: "/" })
		return c.body(null, 204)
	})
