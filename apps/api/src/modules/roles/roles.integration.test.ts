import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import { hashOpaqueToken } from "@/lib/opaque-token.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { describe, expect, it } from "bun:test"

import * as repo from "./roles.repository.ts"
import * as service from "./roles.service.ts"

const DEFAULT_PASSWORD = "correct-horse-battery-staple"

function uniqueUsername(): string {
	return `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
}

async function signIn(username: string, password: string): Promise<string> {
	const response = await app.request("/api/auth/sign-in", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password }),
	})
	const setCookie = response.headers.get("set-cookie")
	if (!setCookie) throw new Error("Expected a Set-Cookie header")
	const [cookiePair] = setCookie.split(";")
	if (!cookiePair) throw new Error("Malformed Set-Cookie header")
	return cookiePair
}

async function createAdminSession(): Promise<{ cookie: string; userId: string }> {
	await sql`TRUNCATE TABLE user_role`
	const username = uniqueUsername()
	const admin = await service.bootstrapAdmin({ username, password: DEFAULT_PASSWORD })
	return { cookie: await signIn(username, DEFAULT_PASSWORD), userId: admin.id }
}

async function createMemberSession(): Promise<string> {
	const username = uniqueUsername()
	await identity.createAccount({ username, password: DEFAULT_PASSWORD })
	return signIn(username, DEFAULT_PASSWORD)
}

describe("roles", () => {
	it("reports that setup is needed before any admin exists", async () => {
		await sql`TRUNCATE TABLE user_role`

		const response = await app.request("/api/setup")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ needsSetup: true })
	})

	it("bootstraps the admin account and then reports setup as complete", async () => {
		await sql`TRUNCATE TABLE user_role`
		const username = uniqueUsername()

		const response = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password: "correct-horse-battery-staple" }),
		})

		expect(response.status).toBe(201)
		const { user } = (await response.json()) as { user: { id: string; username: string } }
		expect(user.username).toBe(username)
		expect(await service.isAdmin(user.id)).toBe(true)

		const statusResponse = await app.request("/api/setup")
		expect(await statusResponse.json()).toEqual({ needsSetup: false })
	})

	it("rejects a second attempt to bootstrap an admin", async () => {
		await sql`TRUNCATE TABLE user_role`
		const seedAdmin = await identity.createAccount({ username: uniqueUsername(), password: "seed-admin-password" })
		await repo.insertUserRole({ id: crypto.randomUUID(), userId: seedAdmin.id, role: "admin" })

		const response = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: uniqueUsername(), password: "another-strong-password" }),
		})

		expect(response.status).toBe(409)
	})

	it("reports a user with no role grant as not admin", async () => {
		const user = await identity.createAccount({ username: uniqueUsername(), password: "not-an-admin-password" })

		expect(await service.isAdmin(user.id)).toBe(false)
	})

	it("enforces at most one admin row at the database level, not just in application code", async () => {
		await sql`TRUNCATE TABLE user_role`
		const userA = await identity.createAccount({ username: uniqueUsername(), password: "direct-insert-password-1" })
		const userB = await identity.createAccount({ username: uniqueUsername(), password: "direct-insert-password-2" })

		// Bypasses roles.service.bootstrapAdmin's application-level hasAdmin() check by
		// inserting through the repository directly, to prove the DB's partial unique
		// index -- not just app code -- rejects a second admin row.
		await repo.insertUserRole({ id: crypto.randomUUID(), userId: userA.id, role: "admin" })
		await expect(repo.insertUserRole({ id: crypto.randomUUID(), userId: userB.id, role: "admin" })).rejects.toThrow()
	})
})

describe("invitations", () => {
	it("lets an admin create an invitation", async () => {
		const { cookie } = await createAdminSession()

		const response = await app.request("/api/invitations", { method: "POST", headers: { Cookie: cookie } })

		expect(response.status).toBe(201)
		const body = (await response.json()) as { expiresAt: string; token: string }
		expect(typeof body.token).toBe("string")
		expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())
	})

	it("denies a non-admin from creating an invitation", async () => {
		const cookie = await createMemberSession()

		const response = await app.request("/api/invitations", { method: "POST", headers: { Cookie: cookie } })

		expect(response.status).toBe(403)
	})

	it("redeems a valid invitation and creates the account", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const inviteResponse = await app.request("/api/invitations", { method: "POST", headers: { Cookie: adminCookie } })
		const { token } = (await inviteResponse.json()) as { token: string }
		const username = uniqueUsername()

		const response = await app.request("/api/invitations/redeem", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token, username, password: "new-member-password" }),
		})

		expect(response.status).toBe(201)
		const { user } = (await response.json()) as { user: { username: string } }
		expect(user.username).toBe(username)
	})

	it("rejects a second attempt to redeem the same invitation", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const inviteResponse = await app.request("/api/invitations", { method: "POST", headers: { Cookie: adminCookie } })
		const { token } = (await inviteResponse.json()) as { token: string }

		const first = await app.request("/api/invitations/redeem", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token, username: uniqueUsername(), password: "first-member-password" }),
		})
		expect(first.status).toBe(201)

		const second = await app.request("/api/invitations/redeem", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token, username: uniqueUsername(), password: "second-member-password" }),
		})
		expect(second.status).toBe(409)
	})

	it("rejects redeeming an expired invitation", async () => {
		const { userId: adminId } = await createAdminSession()
		const token = crypto.randomUUID()
		await repo.insertInvitation({
			id: crypto.randomUUID(),
			tokenHash: hashOpaqueToken(token),
			invitedBy: adminId,
			expiresAt: new Date(Date.now() - 1000),
		})

		const response = await app.request("/api/invitations/redeem", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token, username: uniqueUsername(), password: "expired-invite-password" }),
		})

		expect(response.status).toBe(409)
	})

	it("keeps an invitation usable after a failed redemption due to a taken username", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const inviteResponse = await app.request("/api/invitations", { method: "POST", headers: { Cookie: adminCookie } })
		const { token } = (await inviteResponse.json()) as { token: string }

		const takenUsername = uniqueUsername()
		await identity.createAccount({ username: takenUsername, password: "already-taken-password" })

		const failedAttempt = await app.request("/api/invitations/redeem", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token, username: takenUsername, password: "retry-password-1" }),
		})
		expect(failedAttempt.status).toBe(409)

		const retryAttempt = await app.request("/api/invitations/redeem", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token, username: uniqueUsername(), password: "retry-password-2" }),
		})
		expect(retryAttempt.status).toBe(201)
	})
})
