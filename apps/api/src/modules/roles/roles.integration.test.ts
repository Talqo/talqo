import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import { hashOpaqueToken } from "@/lib/opaque-token.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { describe, expect, it } from "bun:test"

import * as repo from "./roles.repository.ts"
import * as service from "./roles.service.ts"

async function loginResponse(username: string, password: string): Promise<Response> {
	return app.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password }),
	})
}

async function login(username: string, password: string): Promise<string> {
	const response = await loginResponse(username, password)
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
	return { cookie: await login(username, DEFAULT_PASSWORD), userId: admin.id }
}

async function createMemberSession(): Promise<string> {
	const username = uniqueUsername()
	await identity.createAccount({ username, password: DEFAULT_PASSWORD })
	return login(username, DEFAULT_PASSWORD)
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

		// Inserts directly via the repo, bypassing bootstrapAdmin's check, to prove the DB constraint itself rejects it.
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

describe("permission grants", () => {
	it("lets an admin grant a permission to another user", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })

		const response = await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: member.id, permission: "users:invite" }),
		})

		expect(response.status).toBe(201)
		const { grant } = (await response.json()) as {
			grant: { permission: string; userId: string }
		}
		expect(grant.userId).toBe(member.id)
		expect(grant.permission).toBe("users:invite")
	})

	it("denies a non-admin from creating a permission grant", async () => {
		const cookie = await createMemberSession()
		const target = await identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })

		const response = await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: target.id, permission: "users:invite" }),
		})

		expect(response.status).toBe(403)
	})

	it("lets a member with a users:invite grant create invitations, extending the admin-only check", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: member.id, permission: "users:invite" }),
		})

		const memberCookie = await login(memberUsername, DEFAULT_PASSWORD)
		const response = await app.request("/api/invitations", { method: "POST", headers: { Cookie: memberCookie } })

		expect(response.status).toBe(201)
	})

	it("rejects grant bodies that still try to scope a grant to one agent", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const member = await identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })

		const response = await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: member.id, permission: "users:invite", agentId: crypto.randomUUID() }),
		})

		expect(response.status).toBe(400)
	})

	it("denies the very next request after revocation, without touching the member's session", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		const grantResponse = await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: member.id, permission: "users:invite" }),
		})
		const { grant } = (await grantResponse.json()) as { grant: { id: string } }
		const memberCookie = await login(memberUsername, DEFAULT_PASSWORD)

		const beforeRevoke = await app.request("/api/invitations", { method: "POST", headers: { Cookie: memberCookie } })
		expect(beforeRevoke.status).toBe(201)

		const revokeResponse = await app.request(`/api/permission-grants/${grant.id}`, {
			method: "DELETE",
			headers: { Cookie: adminCookie },
		})
		expect(revokeResponse.status).toBe(204)

		// Same cookie, no re-login: proves authorize() reads grants fresh per request
		// rather than relying on anything cached in the session.
		const afterRevoke = await app.request("/api/invitations", { method: "POST", headers: { Cookie: memberCookie } })
		expect(afterRevoke.status).toBe(403)
	})
})

describe("effective permissions", () => {
	it("returns the full permission registry for an admin", async () => {
		const { cookie } = await createAdminSession()

		const response = await app.request("/api/me/permissions", { headers: { Cookie: cookie } })

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ permissions: [...service.PERMISSIONS] })
	})

	it("expands a member's agents:manage grant to include agents:read", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: member.id, permission: "agents:manage" }),
		})
		const memberCookie = await login(memberUsername, DEFAULT_PASSWORD)

		const response = await app.request("/api/me/permissions", { headers: { Cookie: memberCookie } })

		expect(await response.json()).toEqual({ permissions: ["agents:read", "agents:manage"] })
	})

	it("returns an empty list for an ungranted member and reflects grants immediately", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		const memberCookie = await login(memberUsername, DEFAULT_PASSWORD)

		const beforeGrant = await app.request("/api/me/permissions", { headers: { Cookie: memberCookie } })
		expect(await beforeGrant.json()).toEqual({ permissions: [] })

		await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: member.id, permission: "users:invite" }),
		})

		const afterGrant = await app.request("/api/me/permissions", { headers: { Cookie: memberCookie } })
		expect(await afterGrant.json()).toEqual({ permissions: ["users:invite"] })
	})
})

describe("admin password reset", () => {
	it("lets an admin reset a member's password", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })

		const response = await app.request(`/api/users/${member.id}/password`, {
			method: "PATCH",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "admin-reset-password-123" }),
		})

		expect(response.status).toBe(204)
		expect((await loginResponse(memberUsername, DEFAULT_PASSWORD)).status).toBe(401)
		expect((await loginResponse(memberUsername, "admin-reset-password-123")).status).toBe(200)
	})

	it("invalidates the target account's existing sessions once the reset happens", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		const memberCookie = await login(memberUsername, DEFAULT_PASSWORD)
		const memberSessionResponse = await app.request("/api/auth/session", { headers: { Cookie: memberCookie } })
		const { user: member } = (await memberSessionResponse.json()) as { user: { id: string } }

		await app.request(`/api/users/${member.id}/password`, {
			method: "PATCH",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "admin-reset-password-456" }),
		})

		const replayedSession = await app.request("/api/auth/session", { headers: { Cookie: memberCookie } })
		expect(await replayedSession.json()).toEqual({ user: null })
	})

	it("denies a non-admin attempting to reset another account's password", async () => {
		const memberCookie = await createMemberSession()
		const target = await identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })

		const response = await app.request(`/api/users/${target.id}/password`, {
			method: "PATCH",
			headers: { Cookie: memberCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "attempted-takeover-password" }),
		})

		expect(response.status).toBe(403)
	})

	it("returns 404 when resetting the password of a nonexistent user", async () => {
		const { cookie: adminCookie } = await createAdminSession()

		const response = await app.request(`/api/users/${crypto.randomUUID()}/password`, {
			method: "PATCH",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "does-not-matter-password" }),
		})

		expect(response.status).toBe(404)
	})
})
