import { app } from "@/app.ts"
import { hashOpaqueToken } from "@/lib/opaque-token.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { describe, expect, it } from "bun:test"

import * as repo from "./identity.repository.ts"
import * as service from "./identity.service.ts"

function extractSessionCookie(response: Response): string {
	const setCookie = response.headers.get("set-cookie")
	if (!setCookie) throw new Error("Expected a Set-Cookie header")
	const [cookiePair] = setCookie.split(";")
	if (!cookiePair) throw new Error("Malformed Set-Cookie header")
	return cookiePair
}

async function login(username: string, password: string) {
	const response = await app.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password }),
	})
	return response
}

async function createAndLogin(password = DEFAULT_PASSWORD) {
	const username = uniqueUsername()
	await service.createAccount({ username, password })

	const response = await login(username, password)
	const cookie = extractSessionCookie(response)
	const { user } = (await response.json()) as { user: { id: string; username: string } }

	return { username, password, cookie, user }
}

describe("identity", () => {
	it("logs in and establishes an authenticated session", async () => {
		const { cookie, user } = await createAndLogin()

		const response = await app.request("/api/auth/session", { headers: { Cookie: cookie } })

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ user })
	})

	it("rejects login with the wrong password", async () => {
		const username = uniqueUsername()
		await service.createAccount({ username, password: DEFAULT_PASSWORD })

		const response = await login(username, "wrong-password")

		expect(response.status).toBe(401)
	})

	it("invalidates the session server-side on logout, not just client-side", async () => {
		const { cookie } = await createAndLogin()

		const logoutResponse = await app.request("/api/auth/logout", {
			method: "POST",
			headers: { Cookie: cookie },
		})
		expect(logoutResponse.status).toBe(204)

		// Replay the pre-logout cookie directly -- proves server-side deletion, not just
		// that a client would have dropped it.
		const sessionResponse = await app.request("/api/auth/session", { headers: { Cookie: cookie } })
		expect(await sessionResponse.json()).toEqual({ user: null })
	})

	it("requires the current password to change password", async () => {
		const { cookie, username, password } = await createAndLogin()

		const wrongAttempt = await app.request("/api/me/password", {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ currentPassword: "wrong-password", newPassword: "new-password-123" }),
		})
		expect(wrongAttempt.status).toBe(400)

		const correctAttempt = await app.request("/api/me/password", {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ currentPassword: password, newPassword: "new-password-123" }),
		})
		expect(correctAttempt.status).toBe(204)

		expect((await login(username, password)).status).toBe(401)
		expect((await login(username, "new-password-123")).status).toBe(200)
	})

	it("clears mustChangePassword when a self-service change completes", async () => {
		const { username, user } = await createAndLogin()
		await service.setPassword(user.id, "reset-password-789")
		expect((await repo.findUserById(user.id))?.mustChangePassword).toBe(true)

		const cookie = extractSessionCookie(await login(username, "reset-password-789"))
		const response = await app.request("/api/me/password", {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ currentPassword: "reset-password-789", newPassword: "self-chosen-password-000" }),
		})

		expect(response.status).toBe(204)
		expect((await repo.findUserById(user.id))?.mustChangePassword).toBe(false)
	})

	it("completes a forced password change without a current password when one is required", async () => {
		const { username, user } = await createAndLogin()
		await service.setPassword(user.id, "reset-password-321")
		const cookie = extractSessionCookie(await login(username, "reset-password-321"))

		const response = await app.request("/api/me/password/forced", {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "self-chosen-after-reset-000" }),
		})

		expect(response.status).toBe(204)
		expect((await repo.findUserById(user.id))?.mustChangePassword).toBe(false)
		expect((await login(username, "reset-password-321")).status).toBe(401)
		expect((await login(username, "self-chosen-after-reset-000")).status).toBe(200)
	})

	it("rejects a forced password change when none is required", async () => {
		const { cookie } = await createAndLogin()

		const response = await app.request("/api/me/password/forced", {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "attempted-bypass-password" }),
		})

		expect(response.status).toBe(409)
	})

	it("blocks other authenticated routes while a password change is required, not just the SPA redirect", async () => {
		const { username, user } = await createAndLogin()
		await service.setPassword(user.id, "reset-password-654")
		const cookie = extractSessionCookie(await login(username, "reset-password-654"))

		const response = await app.request("/api/me", {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ username: uniqueUsername() }),
		})

		expect(response.status).toBe(403)
	})

	it("updates account info", async () => {
		const { cookie } = await createAndLogin()
		const newUsername = uniqueUsername()

		const response = await app.request("/api/me", {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ username: newUsername }),
		})

		expect(response.status).toBe(200)
		const { user } = (await response.json()) as { user: { username: string } }
		expect(user.username).toBe(newUsername)
	})

	it("rejects updating account username to one already in use", async () => {
		const existing = await createAndLogin()
		const { cookie } = await createAndLogin()

		const response = await app.request("/api/me", {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ username: existing.username }),
		})

		expect(response.status).toBe(409)
	})

	it("deletes the account and invalidates its session", async () => {
		const { cookie, username, password } = await createAndLogin()

		const deleteResponse = await app.request("/api/me", { method: "DELETE", headers: { Cookie: cookie } })
		expect(deleteResponse.status).toBe(204)

		const sessionResponse = await app.request("/api/auth/session", { headers: { Cookie: cookie } })
		expect(await sessionResponse.json()).toEqual({ user: null })

		expect((await login(username, password)).status).toBe(401)
	})

	it("setPassword rotates the password, forces a change, and invalidates existing sessions", async () => {
		const { cookie, username, user } = await createAndLogin()

		await service.setPassword(user.id, "reset-password-456")

		const sessionResponse = await app.request("/api/auth/session", { headers: { Cookie: cookie } })
		expect(await sessionResponse.json()).toEqual({ user: null })

		expect((await login(username, DEFAULT_PASSWORD)).status).toBe(401)
		const loginResponse = await login(username, "reset-password-456")
		expect(loginResponse.status).toBe(200)
		const { user: loggedInUser } = (await loginResponse.json()) as { user: { mustChangePassword: boolean } }
		expect(loggedInUser.mustChangePassword).toBe(true)
	})

	it("purges an expired session from the database on read, not just rejecting it", async () => {
		const username = uniqueUsername()
		const user = await service.createAccount({ username, password: DEFAULT_PASSWORD })
		const token = crypto.randomUUID()
		const tokenHash = hashOpaqueToken(token)
		await repo.insertSession({
			id: crypto.randomUUID(),
			tokenHash,
			userId: user.id,
			expiresAt: new Date(Date.now() - 1000),
		})

		expect(await service.getSession(token)).toBeNull()
		expect(await repo.findSessionByTokenHash(tokenHash)).toBeUndefined()
	})

	it("rejects creating an account with a duplicate username", async () => {
		const username = uniqueUsername()
		await service.createAccount({ username, password: DEFAULT_PASSWORD })

		await expect(service.createAccount({ username, password: DEFAULT_PASSWORD })).rejects.toThrow()
	})
})
