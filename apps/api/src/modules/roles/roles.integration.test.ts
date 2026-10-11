import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import { hashOpaqueToken } from "@/lib/opaque-token.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { beforeEach, describe, expect, it } from "bun:test"

import * as repo from "./roles.repository.ts"
import * as service from "./roles.service.ts"

async function loginResponse(username: string, password: string): Promise<Response> {
	return app.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password }),
	})
}

function sessionCookieFrom(response: Response): string {
	const setCookie = response.headers.get("set-cookie")
	if (!setCookie) throw new Error("Expected a Set-Cookie header")
	const [cookiePair] = setCookie.split(";")
	if (!cookiePair) throw new Error("Malformed Set-Cookie header")
	return cookiePair
}

async function login(username: string, password: string): Promise<string> {
	return sessionCookieFrom(await loginResponse(username, password))
}

async function expectUsableSession(response: Response, username: string): Promise<void> {
	const cookie = sessionCookieFrom(response)
	expect(cookie.startsWith(`${identity.SESSION_COOKIE}=`)).toBe(true)
	const sessionResponse = await app.request("/api/auth/session", { headers: { Cookie: cookie } })
	const body = (await sessionResponse.json()) as { user: { username: string } | null }
	expect(body.user?.username).toBe(username)
}

async function createAdminSession(): Promise<{ cookie: string; userId: string }> {
	await sql`DELETE FROM permission_grant WHERE permission = 'admin' AND agent_id IS NULL`
	const username = uniqueUsername()
	const admin = await service.bootstrapAdmin({ username, password: DEFAULT_PASSWORD })
	return { cookie: await login(username, DEFAULT_PASSWORD), userId: admin.id }
}

async function createRole(permissions: service.Permission[], name = `Role ${crypto.randomUUID()}`) {
	return service.createRole({ name, permissions })
}

async function createMember(): Promise<identity.PublicUser> {
	return identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })
}

async function memberWith(permissions: service.Permission[]): Promise<{ cookie: string; userId: string }> {
	const member = await createMember()
	await Promise.all(
		permissions.map((permission) => service.grantPermission({ userId: member.id, permission, grantedBy: member.id })),
	)
	const { token } = await identity.createSession(member.id)
	return { cookie: `${identity.SESSION_COOKIE}=${token}`, userId: member.id }
}

async function call(cookie: string, method: string, path: string, body?: unknown): Promise<Response> {
	return app.request(`/api${path}`, {
		method,
		headers: { Cookie: cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
}

async function expectCode(response: Response, status: number, code: string): Promise<void> {
	expect(response.status).toBe(status)
	expect(await response.json()).toMatchObject({ code })
}

async function createMemberSession(): Promise<string> {
	const username = uniqueUsername()
	await identity.createAccount({ username, password: DEFAULT_PASSWORD })
	return login(username, DEFAULT_PASSWORD)
}

describe("roles", () => {
	it("reports that setup is needed before any admin exists", async () => {
		await sql`DELETE FROM permission_grant WHERE permission = 'admin' AND agent_id IS NULL`

		const response = await app.request("/api/setup")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ needsSetup: true })
	})

	it("bootstraps the admin account and then reports setup as complete", async () => {
		await sql`DELETE FROM permission_grant WHERE permission = 'admin' AND agent_id IS NULL`
		const username = uniqueUsername()

		const response = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password: "correct-horse-battery-staple" }),
		})

		expect(response.status).toBe(201)
		const { user } = (await response.json()) as { user: { id: string; username: string } }
		expect(user.username).toBe(username)
		expect(await service.authorize(user.id, "admin")).toBe(true)

		// Bootstrap issues a session directly: the setup page never falls back to a second login.
		await expectUsableSession(response, username)

		const statusResponse = await app.request("/api/setup")
		expect(await statusResponse.json()).toEqual({ needsSetup: false })
	})

	it("rejects a second attempt to bootstrap an admin", async () => {
		await sql`DELETE FROM permission_grant WHERE permission = 'admin' AND agent_id IS NULL`
		const seedAdmin = await identity.createAccount({ username: uniqueUsername(), password: "seed-admin-password" })
		await service.grantPermission({ userId: seedAdmin.id, permission: "admin", grantedBy: seedAdmin.id })

		const response = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: uniqueUsername(), password: "another-strong-password" }),
		})

		expect(response.status).toBe(409)
	})

	it("reports a user with no admin grant as not authorized for admin", async () => {
		const user = await identity.createAccount({ username: uniqueUsername(), password: "not-an-admin-password" })

		expect(await service.authorize(user.id, "admin")).toBe(false)
	})

	it("denies a member without grants from listing users", async () => {
		const cookie = await createMemberSession()

		const response = await app.request("/api/users", { headers: { Cookie: cookie } })

		expect(response.status).toBe(403)
		expect(await response.json()).toMatchObject({ code: "permission-denied" })
	})

	it("enforces at most one admin grant at the database level, not just in application code", async () => {
		await sql`DELETE FROM permission_grant WHERE permission = 'admin' AND agent_id IS NULL`
		const userA = await identity.createAccount({ username: uniqueUsername(), password: "direct-insert-password-1" })
		const userB = await identity.createAccount({ username: uniqueUsername(), password: "direct-insert-password-2" })

		// Inserts directly via the repo, bypassing bootstrapAdmin's check, to prove the DB constraint itself rejects it.
		await repo.insertPermissionGrant({
			id: crypto.randomUUID(),
			userId: userA.id,
			permission: "admin",
			grantedBy: null,
		})
		await expect(
			repo.insertPermissionGrant({ id: crypto.randomUUID(), userId: userB.id, permission: "admin", grantedBy: null }),
		).rejects.toThrow()
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

		// Redeem issues a session directly: the accept-invite page never falls back to a second login.
		await expectUsableSession(response, username)
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
			expiresAt: new Date(Date.now() - 60_000),
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
			body: JSON.stringify({ userId: member.id, permission: "ai_provider:manage" }),
		})

		expect(response.status).toBe(201)
		const { grant } = (await response.json()) as {
			grant: { permission: string; userId: string }
		}
		expect(grant.userId).toBe(member.id)
		expect(grant.permission).toBe("ai_provider:manage")
	})

	it("denies a non-admin from creating a permission grant", async () => {
		const cookie = await createMemberSession()
		const target = await identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })

		const response = await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: target.id, permission: "ai_provider:manage" }),
		})

		expect(response.status).toBe(403)
	})

	it("rejects grant bodies that still try to scope a grant to one agent", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const member = await identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })

		const response = await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: member.id, permission: "ai_provider:manage", agentId: crypto.randomUUID() }),
		})

		expect(response.status).toBe(400)
	})

	it("rejects a second admin grant even for the already-admin user", async () => {
		const { cookie: adminCookie, userId: adminId } = await createAdminSession()

		const response = await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: adminId, permission: "admin" }),
		})

		expect(response.status).toBe(409)
	})

	it("denies the very next request after revocation, without touching the member's session", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		const grantResponse = await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: member.id, permission: "agents:read" }),
		})
		const { grant } = (await grantResponse.json()) as { grant: { id: string } }
		const memberCookie = await login(memberUsername, DEFAULT_PASSWORD)

		const beforeRevoke = await app.request("/api/agents", { headers: { Cookie: memberCookie } })
		expect(beforeRevoke.status).toBe(200)

		const revokeResponse = await app.request(`/api/permission-grants/${grant.id}`, {
			method: "DELETE",
			headers: { Cookie: adminCookie },
		})
		expect(revokeResponse.status).toBe(204)

		// Same cookie, no re-login: proves authorize() reads grants fresh per request
		// rather than relying on anything cached in the session.
		const afterRevoke = await app.request("/api/agents", { headers: { Cookie: memberCookie } })
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
			body: JSON.stringify({ userId: member.id, permission: "ai_provider:manage" }),
		})

		const afterGrant = await app.request("/api/me/permissions", { headers: { Cookie: memberCookie } })
		expect(await afterGrant.json()).toEqual({ permissions: ["ai_provider:manage"] })
	})

	it("authorizes through an assigned role, including implied permissions", async () => {
		const member = await createMember()
		await service.assignRoles(member.id, [(await createRole(["agents:manage"])).id])

		expect(await service.authorize(member.id, "agents:read")).toBe(true)
		expect(await service.listEffectivePermissions(member.id)).toEqual(["agents:read", "agents:manage"])
	})

	it("unions permissions across grants and every assigned role", async () => {
		const member = await createMember()
		await service.grantPermission({ userId: member.id, permission: "ai_provider:manage", grantedBy: member.id })
		const roles = [await createRole(["agents:read"]), await createRole(["agents:manage"])]
		await service.assignRoles(
			member.id,
			roles.map((role) => role.id),
		)

		expect(await service.listEffectivePermissions(member.id)).toEqual([
			"ai_provider:manage",
			"agents:read",
			"agents:manage",
		])
	})

	it("denies the next check once a role assignment is removed", async () => {
		const member = await createMember()
		await service.assignRoles(member.id, [(await createRole(["ai_provider:manage"])).id])
		expect(await service.authorize(member.id, "ai_provider:manage")).toBe(true)

		await service.assignRoles(member.id, [])

		expect(await service.authorize(member.id, "ai_provider:manage")).toBe(false)
	})
})

describe("role management", () => {
	beforeEach(async () => {
		await sql`DELETE FROM role`
	})

	it("creates, lists, updates and deletes a role", async () => {
		const member = await createMember()
		const created = await createRole(["agents:manage", "ai_provider:manage"], "  Support  ")
		await service.assignRoles(member.id, [created.id])

		expect(created).toEqual({
			id: created.id,
			name: "Support",
			permissions: ["ai_provider:manage", "agents:manage"],
			memberCount: 0,
		})
		expect(await service.listRoles()).toEqual([{ ...created, memberCount: 1 }])

		const updated = await service.updateRole(created.id, { name: "Helpdesk", permissions: ["agents:read"] })
		expect(updated).toEqual({ id: created.id, name: "Helpdesk", permissions: ["agents:read"], memberCount: 1 })

		await service.deleteRole(created.id)
		expect(await service.listRoles()).toEqual([])
		expect(await service.listEffectivePermissions(member.id)).toEqual([])
	})

	it("lists roles by name, case-insensitively", async () => {
		await createRole([], "beta")
		await createRole([], "Alpha")

		expect((await service.listRoles()).map((role) => role.name)).toEqual(["Alpha", "beta"])
	})

	it("rejects a role name already taken in any letter case", async () => {
		const existing = await createRole([], "Support")
		const other = await createRole([], "Sales")

		await expect(createRole([], "SUPPORT")).rejects.toBeInstanceOf(service.DuplicateRoleNameError)
		await expect(service.updateRole(other.id, { name: "support", permissions: [] })).rejects.toBeInstanceOf(
			service.DuplicateRoleNameError,
		)
		expect(await service.updateRole(existing.id, { name: "SUPPORT", permissions: [] })).toMatchObject({
			name: "SUPPORT",
		})
	})

	it("rejects invalid role input", async () => {
		await expect(createRole([], "   ")).rejects.toBeInstanceOf(service.InvalidRoleInputError)
		await expect(createRole([], "x".repeat(service.ROLE_NAME_MAX_LENGTH + 1))).rejects.toBeInstanceOf(
			service.InvalidRoleInputError,
		)
		await expect(createRole(["admin"])).rejects.toBeInstanceOf(service.InvalidRoleInputError)
		await expect(createRole(["agents:read", "agents:read"])).rejects.toBeInstanceOf(service.InvalidRoleInputError)
	})

	it("reports an unknown role on update and delete", async () => {
		const missing = crypto.randomUUID()

		await expect(service.updateRole(missing, { name: "Gone", permissions: [] })).rejects.toBeInstanceOf(
			service.RoleNotFoundError,
		)
		await expect(service.deleteRole(missing)).rejects.toBeInstanceOf(service.RoleNotFoundError)
	})

	it("lists every permission except admin with what each implies", () => {
		expect(service.listGrantablePermissions()).toEqual([
			{ permission: "users:read", implies: [] },
			{ permission: "users:manage", implies: ["users:read"] },
			{ permission: "roles:manage", implies: ["users:read"] },
			{ permission: "ai_provider:manage", implies: [] },
			{ permission: "agents:read", implies: [] },
			{ permission: "agents:manage", implies: ["agents:read"] },
		])
	})
})

describe("role assignment", () => {
	it("replaces a user's roles and returns them by name", async () => {
		const member = await createMember()
		const [support, sales, billing] = await Promise.all([
			createRole([], `Support ${crypto.randomUUID()}`),
			createRole([], `Sales ${crypto.randomUUID()}`),
			createRole([], `Billing ${crypto.randomUUID()}`),
		])
		await service.assignRoles(member.id, [support.id, sales.id])

		const assigned = await service.assignRoles(member.id, [sales.id, billing.id])

		expect(assigned).toEqual([
			{ id: billing.id, name: billing.name },
			{ id: sales.id, name: sales.name },
		])
	})

	it("rejects an unknown user, an unknown role and duplicate role ids without changing anything", async () => {
		const member = await createMember()
		const role = await createRole(["agents:read"])
		await service.assignRoles(member.id, [role.id])

		await expect(service.assignRoles(crypto.randomUUID(), [])).rejects.toBeInstanceOf(identity.UserNotFoundError)
		await expect(service.assignRoles(member.id, [crypto.randomUUID()])).rejects.toBeInstanceOf(
			service.RoleNotFoundError,
		)
		await expect(service.assignRoles(member.id, [role.id, role.id])).rejects.toBeInstanceOf(
			service.InvalidRoleInputError,
		)
		expect(await service.listEffectivePermissions(member.id)).toEqual(["agents:read"])
	})

	it("drops assignments when the user is deleted", async () => {
		const member = await createMember()
		const role = await createRole([])
		await service.assignRoles(member.id, [role.id])

		await identity.deleteAccount(member.id)

		const listed = (await service.listRoles()).find(({ id }) => id === role.id)
		expect(listed?.memberCount).toBe(0)
	})
})

describe("target resolvers", () => {
	it("returns the requested permissions of a new role", async () => {
		expect(await service.permissionsInRoleRequest({ body: { name: "New", permissions: ["agents:read"] } })).toEqual([
			"agents:read",
		])
	})

	it("returns a role's current and requested permissions for an update", async () => {
		const role = await createRole(["ai_provider:manage"])

		const targeted = await service.permissionsInRoleUpdate({
			params: { roleId: role.id },
			body: { name: role.name, permissions: ["agents:read"] },
		})

		expect(targeted).toEqual(["ai_provider:manage", "agents:read"])
	})

	it("returns a role's permissions, or none for an unknown role", async () => {
		const role = await createRole(["agents:manage"])

		expect(await service.permissionsOfRole({ params: { roleId: role.id } })).toEqual(["agents:manage"])
		expect(await service.permissionsOfRole({ params: { roleId: crypto.randomUUID() } })).toEqual([])
	})

	it("returns only the permissions of roles an assignment adds or removes", async () => {
		const member = await createMember()
		const [kept, removed, added] = await Promise.all([
			createRole(["ai_provider:manage"]),
			createRole(["agents:manage"]),
			createRole(["users:read"]),
		])
		await service.assignRoles(member.id, [kept.id, removed.id])

		const targeted = await service.permissionsInRoleAssignment({
			params: { userId: member.id },
			body: { roleIds: [kept.id, added.id, crypto.randomUUID()] },
		})

		expect(targeted).toEqual(["users:read", "agents:manage"])
	})

	it("returns a user's effective permissions from grants and roles", async () => {
		const member = await createMember()
		await service.grantPermission({ userId: member.id, permission: "agents:manage", grantedBy: member.id })
		await service.assignRoles(member.id, [(await createRole(["users:read"])).id])

		expect(await service.permissionsOfUser({ params: { userId: member.id } })).toEqual([
			"users:read",
			"agents:read",
			"agents:manage",
		])
	})

	it("returns every permission for the admin", async () => {
		const { userId } = await createAdminSession()

		expect(await service.permissionsOfUser({ params: { userId } })).toEqual([...service.PERMISSIONS])
	})
})

function roleBody(permissions: service.Permission[], name = `Role ${crypto.randomUUID()}`) {
	return { name, permissions }
}

describe("role routes", () => {
	it("lists grantable permissions for a role manager and denies other members", async () => {
		const manager = await memberWith(["roles:manage"])
		const member = await memberWith(["users:manage"])

		const response = await call(manager.cookie, "GET", "/permissions")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ permissions: service.listGrantablePermissions() })
		await expectCode(await call(member.cookie, "GET", "/permissions"), 403, "permission-denied")
	})

	it("creates, lists, updates and deletes a role within the manager's own permissions", async () => {
		const manager = await memberWith(["roles:manage", "agents:manage"])

		const created = await call(manager.cookie, "POST", "/roles", roleBody(["agents:read"], "Readers"))
		expect(created.status).toBe(201)
		const { role } = (await created.json()) as { role: service.Role }
		expect(role).toEqual({ id: role.id, name: "Readers", permissions: ["agents:read"], memberCount: 0 })

		const listed = (await (await call(manager.cookie, "GET", "/roles")).json()) as { roles: service.Role[] }
		expect(listed.roles).toContainEqual(role)

		const updated = await call(manager.cookie, "PUT", `/roles/${role.id}`, roleBody(["agents:manage"], "Editors"))
		expect(updated.status).toBe(200)
		expect(await updated.json()).toEqual({ role: { ...role, name: "Editors", permissions: ["agents:manage"] } })

		expect((await call(manager.cookie, "DELETE", `/roles/${role.id}`)).status).toBe(204)
	})

	it("answers 404 for an unknown role and 409 for a taken name", async () => {
		const manager = await memberWith(["roles:manage"])
		const existing = await createRole([])
		const missing = crypto.randomUUID()

		await expectCode(await call(manager.cookie, "PUT", `/roles/${missing}`, roleBody([])), 404, "role-not-found")
		await expectCode(await call(manager.cookie, "DELETE", `/roles/${missing}`), 404, "role-not-found")
		await expectCode(
			await call(manager.cookie, "POST", "/roles", roleBody([], existing.name.toUpperCase())),
			409,
			"role-name-taken",
		)
	})

	it("rejects admin, unknown and repeated permissions in a role", async () => {
		const { cookie } = await createAdminSession()

		for (const permissions of [["admin"], ["agents:fly"], ["agents:read", "agents:read"]]) {
			// oxlint-disable-next-line no-await-in-loop -- asserts each body in order.
			await expectCode(await call(cookie, "POST", "/roles", { name: "Bad", permissions }), 400, "invalid-request")
		}
	})

	it("refuses role changes that involve permissions the manager lacks", async () => {
		const manager = await memberWith(["roles:manage", "agents:read"])
		const powerful = await createRole(["ai_provider:manage"])
		const exceeds = "permission-exceeds-own"

		await expectCode(await call(manager.cookie, "POST", "/roles", roleBody(["agents:manage"])), 403, exceeds)
		await expectCode(
			await call(manager.cookie, "PUT", `/roles/${powerful.id}`, roleBody([], powerful.name)),
			403,
			exceeds,
		)
		await expectCode(await call(manager.cookie, "DELETE", `/roles/${powerful.id}`), 403, exceeds)
		expect(await service.listRoles()).toContainEqual(powerful)
	})

	it("assigns roles and answers 404 for an unknown user or role", async () => {
		const manager = await memberWith(["roles:manage", "agents:manage"])
		const member = await createMember()
		const role = await createRole(["agents:read"])

		const response = await call(manager.cookie, "PUT", `/users/${member.id}/roles`, { roleIds: [role.id] })

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ roles: [{ id: role.id, name: role.name }] })
		await expectCode(
			await call(manager.cookie, "PUT", `/users/${crypto.randomUUID()}/roles`, { roleIds: [] }),
			404,
			"user-not-found",
		)
		await expectCode(
			await call(manager.cookie, "PUT", `/users/${member.id}/roles`, { roleIds: [crypto.randomUUID()] }),
			404,
			"role-not-found",
		)
	})

	it("refuses assigning or removing a role beyond the manager's permissions but leaves kept roles alone", async () => {
		const manager = await memberWith(["roles:manage", "agents:read"])
		const member = await createMember()
		const [powerful, reader] = await Promise.all([createRole(["ai_provider:manage"]), createRole(["agents:read"])])
		const assign = (roleIds: string[]) => call(manager.cookie, "PUT", `/users/${member.id}/roles`, { roleIds })

		await expectCode(await assign([powerful.id]), 403, "permission-exceeds-own")

		await service.assignRoles(member.id, [powerful.id])
		await expectCode(await assign([]), 403, "permission-exceeds-own")
		expect((await assign([powerful.id, reader.id])).status).toBe(200)
	})
})

describe("user management routes", () => {
	it("lists users with their roles and permissions for users:read", async () => {
		const reader = await memberWith(["users:read"])
		const member = await createMember()
		const role = await createRole(["agents:manage"])
		await service.assignRoles(member.id, [role.id])

		const response = await call(reader.cookie, "GET", "/users")

		expect(response.status).toBe(200)
		const { users } = (await response.json()) as { users: service.UserWithAccess[] }
		expect(users.find(({ id }) => id === member.id)).toEqual({
			id: member.id,
			username: member.username,
			mustChangePassword: false,
			roles: [{ id: role.id, name: role.name }],
			permissions: ["agents:read", "agents:manage"],
		})
	})

	it("lets users:manage invite but not users:read", async () => {
		const manager = await memberWith(["users:manage"])
		const reader = await memberWith(["users:read"])

		expect((await call(manager.cookie, "POST", "/invitations")).status).toBe(201)
		await expectCode(await call(reader.cookie, "POST", "/invitations"), 403, "permission-denied")
	})

	it("lets users:manage reset and delete a user whose permissions they hold", async () => {
		const manager = await memberWith(["users:manage", "agents:read"])
		const target = await memberWith(["agents:read"])

		const reset = await call(manager.cookie, "PATCH", `/users/${target.userId}/password`, {
			newPassword: "reset-by-manager-123",
		})

		expect(reset.status).toBe(204)
		expect((await call(manager.cookie, "DELETE", `/users/${target.userId}`)).status).toBe(204)
	})

	it("refuses resetting or deleting the admin or a user with a grant the manager lacks", async () => {
		const manager = await memberWith(["users:manage"])
		const { userId: adminId } = await createAdminSession()
		const granted = await memberWith(["ai_provider:manage"])

		const reset = (userId: string) =>
			call(manager.cookie, "PATCH", `/users/${userId}/password`, { newPassword: "takeover-password-123" })

		await expectCode(await reset(adminId), 403, "permission-exceeds-own")
		await expectCode(await reset(granted.userId), 403, "permission-exceeds-own")
		await expectCode(await call(manager.cookie, "DELETE", `/users/${adminId}`), 403, "permission-exceeds-own")
		await expectCode(await call(manager.cookie, "DELETE", `/users/${granted.userId}`), 403, "permission-exceeds-own")
	})

	it("answers 404 when resetting or deleting an unknown user", async () => {
		const manager = await memberWith(["users:manage"])
		const missing = crypto.randomUUID()

		await expectCode(
			await call(manager.cookie, "PATCH", `/users/${missing}/password`, { newPassword: "reset-unknown-123" }),
			404,
			"user-not-found",
		)
		await expectCode(await call(manager.cookie, "DELETE", `/users/${missing}`), 404, "user-not-found")
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
		const memberLogin = await loginResponse(memberUsername, "admin-reset-password-123")
		expect(memberLogin.status).toBe(200)
		const { user: loggedInMember } = (await memberLogin.json()) as { user: { mustChangePassword: boolean } }
		expect(loggedInMember.mustChangePassword).toBe(true)
	})

	it("lets the reset target complete a forced change without re-entering the admin-set password", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })

		await app.request(`/api/users/${member.id}/password`, {
			method: "PATCH",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "admin-reset-password-789" }),
		})
		const memberCookie = await login(memberUsername, "admin-reset-password-789")

		const response = await app.request("/api/me/password/forced", {
			method: "PATCH",
			headers: { Cookie: memberCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "member-chosen-after-reset-000" }),
		})

		expect(response.status).toBe(204)
		expect((await loginResponse(memberUsername, "admin-reset-password-789")).status).toBe(401)
		const finalLogin = await loginResponse(memberUsername, "member-chosen-after-reset-000")
		expect(finalLogin.status).toBe(200)
		const { user: finalUser } = (await finalLogin.json()) as { user: { mustChangePassword: boolean } }
		expect(finalUser.mustChangePassword).toBe(false)
	})

	it("blocks every other session route until a pending password change is completed", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		await app.request(`/api/users/${member.id}/password`, {
			method: "PATCH",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "admin-reset-password-456" }),
		})
		const memberCookie = await login(memberUsername, "admin-reset-password-456")

		const response = await app.request("/api/access", { headers: { Cookie: memberCookie } })

		expect(response.status).toBe(403)
		expect(await response.json()).toMatchObject({ code: "password-change-required" })
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

	it("rejects an admin resetting their own password through this endpoint", async () => {
		const { cookie: adminCookie, userId: adminId } = await createAdminSession()

		const response = await app.request(`/api/users/${adminId}/password`, {
			method: "PATCH",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "attempted-self-reset-password" }),
		})

		expect(response.status).toBe(400)
	})
})

describe("admin user deletion", () => {
	it("lets an admin delete a member, ending their sessions and login", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		const memberCookie = await login(memberUsername, DEFAULT_PASSWORD)

		const response = await app.request(`/api/users/${member.id}`, {
			method: "DELETE",
			headers: { Cookie: adminCookie },
		})

		expect(response.status).toBe(204)
		const replayedSession = await app.request("/api/auth/session", { headers: { Cookie: memberCookie } })
		expect(await replayedSession.json()).toEqual({ user: null })
		expect((await loginResponse(memberUsername, DEFAULT_PASSWORD)).status).toBe(401)
		const listed = await app.request("/api/users", { headers: { Cookie: adminCookie } })
		const { users } = (await listed.json()) as { users: { id: string }[] }
		expect(users.map((user) => user.id)).not.toContain(member.id)
	})

	it("denies a non-admin deleting another account", async () => {
		const memberCookie = await createMemberSession()
		const target = await identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })

		const response = await app.request(`/api/users/${target.id}`, {
			method: "DELETE",
			headers: { Cookie: memberCookie },
		})

		expect(response.status).toBe(403)
	})

	it("returns 404 when deleting a nonexistent user", async () => {
		const { cookie: adminCookie } = await createAdminSession()

		const response = await app.request(`/api/users/${crypto.randomUUID()}`, {
			method: "DELETE",
			headers: { Cookie: adminCookie },
		})

		expect(response.status).toBe(404)
		expect(((await response.json()) as { code: string }).code).toBe("user-not-found")
	})

	it("rejects an admin deleting their own account through this endpoint", async () => {
		const { cookie: adminCookie, userId: adminId } = await createAdminSession()

		const response = await app.request(`/api/users/${adminId}`, {
			method: "DELETE",
			headers: { Cookie: adminCookie },
		})

		expect(response.status).toBe(400)
		expect(((await response.json()) as { code: string }).code).toBe("self-delete-not-allowed")
		expect(await service.hasAdmin()).toBe(true)
	})
})

describe("list users", () => {
	it("lets an admin list all users", async () => {
		const { cookie: adminCookie, userId: adminId } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })

		const response = await app.request("/api/users", { headers: { Cookie: adminCookie } })

		expect(response.status).toBe(200)
		const { users } = (await response.json()) as { users: { id: string; mustChangePassword: boolean }[] }
		const ids = users.map((user) => user.id)
		expect(ids).toContain(adminId)
		expect(ids).toContain(member.id)
		expect(users.find((user) => user.id === member.id)?.mustChangePassword).toBe(false)
	})
})

describe("access", () => {
	it("reports every registered permission for an admin", async () => {
		const { cookie: adminCookie } = await createAdminSession()

		const response = await app.request("/api/access", { headers: { Cookie: adminCookie } })

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ permissions: [...service.PERMISSIONS] })
	})

	it("reports no permissions for an ungranted member", async () => {
		const memberCookie = await createMemberSession()

		const response = await app.request("/api/access", { headers: { Cookie: memberCookie } })

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ permissions: [] })
	})
})
