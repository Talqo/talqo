import { app } from "@/app.ts"
import { describe, expect, it } from "bun:test"

import * as service from "./identity.service.ts"

const DEFAULT_PASSWORD = "correct-horse-battery-staple"

function uniqueUsername(): string {
	return `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
}

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

	it("setPassword rotates the password and invalidates existing sessions", async () => {
		const { cookie, username, user } = await createAndLogin()

		await service.setPassword(user.id, "reset-password-456")

		const sessionResponse = await app.request("/api/auth/session", { headers: { Cookie: cookie } })
		expect(await sessionResponse.json()).toEqual({ user: null })

		expect((await login(username, DEFAULT_PASSWORD)).status).toBe(401)
		expect((await login(username, "reset-password-456")).status).toBe(200)
	})

	it("rejects creating an account with a duplicate username", async () => {
		const username = uniqueUsername()
		await service.createAccount({ username, password: DEFAULT_PASSWORD })

		await expect(service.createAccount({ username, password: DEFAULT_PASSWORD })).rejects.toThrow()
	})
})
