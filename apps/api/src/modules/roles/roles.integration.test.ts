import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import { hashOpaqueToken } from "@/lib/opaque-token.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { DEFAULT_PASSWORD, giveRole, testAdminId, uniqueUsername } from "@/test-helpers.ts"
import { beforeEach, describe, expect, it, spyOn } from "bun:test"

import * as repo from "./roles.repository.ts"
import * as seed from "./roles.seed.ts"
import * as service from "./roles.service.ts"

// Postgres check_violation (https://www.postgresql.org/docs/current/errcodes-appendix.html).
const CHECK_VIOLATION = "23514"

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
	await sql`DELETE FROM permission_grant WHERE permission = 'admin'`
	const username = uniqueUsername()
	const admin = await service.bootstrapAdmin({ username, password: DEFAULT_PASSWORD })
	return { cookie: await login(username, DEFAULT_PASSWORD), userId: admin.id }
}

async function createRole(permissions: service.Permission[], name = `Role ${crypto.randomUUID()}`) {
	return service.createRole({ name, permissions }, await testAdminId())
}

async function assignRoles(userId: string, roleIds: string[]): Promise<service.RoleSummary[]> {
	return service.assignRoles(userId, roleIds, await testAdminId())
}

async function updateRole(id: string, input: service.RoleInput): Promise<service.Role> {
	return service.updateRole(id, input, await testAdminId())
}

async function deleteRole(id: string): Promise<void> {
	await service.deleteRole(id, await testAdminId())
}

async function createMember(): Promise<identity.PublicUser> {
	return identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })
}

async function memberWith(permissions: service.GrantablePermission[]): Promise<{ cookie: string; userId: string }> {
	const member = await createMember()
	await giveRole(member.id, permissions)
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
		await sql`DELETE FROM permission_grant WHERE permission = 'admin'`

		const response = await app.request("/api/setup")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ needsSetup: true })
	})

	it("bootstraps the admin account and then reports setup as complete", async () => {
		await sql`DELETE FROM permission_grant WHERE permission = 'admin'`
		const username = uniqueUsername()

		const response = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password: "correct-horse-battery-staple" }),
		})

		expect(response.status).toBe(201)
		const { user } = (await response.json()) as { user: { id: string; username: string } }
		expect(user.username).toBe(username)
		expect(await service.listEffectivePermissions(user.id)).toContain("admin")

		// Bootstrap issues a session directly: the setup page never falls back to a second login.
		await expectUsableSession(response, username)

		const statusResponse = await app.request("/api/setup")
		expect(await statusResponse.json()).toEqual({ needsSetup: false })
	})

	it("rejects a second attempt to bootstrap an admin", async () => {
		await sql`DELETE FROM permission_grant WHERE permission = 'admin'`
		const seedAdmin = await identity.createAccount({ username: uniqueUsername(), password: "seed-admin-password" })
		await repo.insertPermissionGrant({
			id: crypto.randomUUID(),
			userId: seedAdmin.id,
			permission: "admin",
			grantedBy: seedAdmin.id,
		})

		const response = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: uniqueUsername(), password: "another-strong-password" }),
		})

		expect(response.status).toBe(409)
	})

	it("reports a user with no admin grant as not authorized for admin", async () => {
		const user = await identity.createAccount({ username: uniqueUsername(), password: "not-an-admin-password" })

		expect(await service.listEffectivePermissions(user.id)).not.toContain("admin")
	})

	it("denies a member without grants from listing users", async () => {
		const cookie = await createMemberSession()

		const response = await app.request("/api/users", { headers: { Cookie: cookie } })

		expect(response.status).toBe(403)
		expect(await response.json()).toMatchObject({ code: "permission-denied" })
	})

	it("enforces at most one admin grant at the database level, not just in application code", async () => {
		await sql`DELETE FROM permission_grant WHERE permission = 'admin'`
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

describe("admin grant", () => {
	it("denies a non-admin from creating an invitation", async () => {
		const cookie = await createMemberSession()

		const response = await app.request("/api/invitations", { method: "POST", headers: { Cookie: cookie } })

		expect(response.status).toBe(403)
	})

	it("refuses any direct grant other than admin at the database level", async () => {
		const member = await createMember()

		const refused = await repo
			.insertPermissionGrant({
				id: crypto.randomUUID(),
				userId: member.id,
				permission: "agents:read",
				grantedBy: member.id,
			})
			.catch((error: unknown) => error)

		expect(refused).toMatchObject({ cause: { code: CHECK_VIOLATION, constraint_name: "permission_grant_admin_only" } })
	})

	it("refuses admin in a role at the database level, not just in the API", async () => {
		const role = await createRole([])

		const refused = await sql`INSERT INTO role_permission (role_id, permission) VALUES (${role.id}, 'admin')`.catch(
			(error: unknown) => error,
		)

		expect(refused).toMatchObject({ code: CHECK_VIOLATION, constraint_name: "role_permission_not_admin" })
	})

	it("no longer offers the direct grant routes", async () => {
		const { cookie } = await createAdminSession()

		const response = await call(cookie, "POST", "/permission-grants", {
			userId: crypto.randomUUID(),
			permission: "agents:read",
		})

		await expectCode(response, 404, "route-not-found")
	})

	it("denies the very next request after a role is removed, without touching the member's session", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		await giveRole(member.id, ["agents:read"])
		const memberCookie = await login(memberUsername, DEFAULT_PASSWORD)

		const beforeRemoval = await app.request("/api/agents", { headers: { Cookie: memberCookie } })
		expect(beforeRemoval.status).toBe(200)

		expect((await call(adminCookie, "PUT", `/users/${member.id}/roles`, { roleIds: [] })).status).toBe(200)

		// Same cookie, no re-login: proves authorize() reads permissions fresh per request
		// rather than relying on anything cached in the session.
		const afterRemoval = await app.request("/api/agents", { headers: { Cookie: memberCookie } })
		expect(afterRemoval.status).toBe(403)
	})
})

describe("effective permissions", () => {
	it("returns the full permission registry for an admin", async () => {
		const { cookie } = await createAdminSession()

		const response = await app.request("/api/me/permissions", { headers: { Cookie: cookie } })

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ permissions: [...service.PERMISSIONS] })
	})

	it("expands a member's agents:manage role to include agents:read", async () => {
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		await giveRole(member.id, ["agents:manage"])
		const memberCookie = await login(memberUsername, DEFAULT_PASSWORD)

		const response = await app.request("/api/me/permissions", { headers: { Cookie: memberCookie } })

		expect(await response.json()).toEqual({ permissions: ["agents:read", "agents:manage"] })
	})

	it("returns an empty list for a member without roles and reflects a new role immediately", async () => {
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		const memberCookie = await login(memberUsername, DEFAULT_PASSWORD)

		const beforeGrant = await app.request("/api/me/permissions", { headers: { Cookie: memberCookie } })
		expect(await beforeGrant.json()).toEqual({ permissions: [] })

		await giveRole(member.id, ["ai_provider:manage"])

		const afterGrant = await app.request("/api/me/permissions", { headers: { Cookie: memberCookie } })
		expect(await afterGrant.json()).toEqual({ permissions: ["ai_provider:manage"] })
	})

	it("authorizes through an assigned role, including implied permissions", async () => {
		const member = await createMember()
		await assignRoles(member.id, [(await createRole(["agents:manage"])).id])

		expect(await service.listEffectivePermissions(member.id)).toEqual(["agents:read", "agents:manage"])
	})

	it("unions permissions across every assigned role", async () => {
		const member = await createMember()
		const roles = [
			await createRole(["ai_provider:manage"]),
			await createRole(["agents:read"]),
			await createRole(["agents:manage"]),
		]
		await assignRoles(
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
		await assignRoles(member.id, [(await createRole(["ai_provider:manage"])).id])
		expect(await service.listEffectivePermissions(member.id)).toContain("ai_provider:manage")

		await assignRoles(member.id, [])

		expect(await service.listEffectivePermissions(member.id)).not.toContain("ai_provider:manage")
	})
})

describe("role management", () => {
	beforeEach(async () => {
		await sql`DELETE FROM role`
	})

	it("seeds reusable roles without granting access or overwriting edits on rerun", async () => {
		await seed.seed()
		const roles = await service.listRoles()
		expect(roles.map(({ name, permissions }) => ({ name, permissions }))).toEqual([
			{ name: "Agent editors", permissions: ["agents:manage"] },
			{ name: "Support", permissions: ["agents:read"] },
			{ name: "Team managers", permissions: ["users:manage", "roles:manage"] },
		])
		const member = await createMember()
		expect(await service.listEffectivePermissions(member.id)).toEqual([])
		const support = roles.find(({ name }) => name === "Support")
		if (!support) throw new Error("Support role was not seeded")
		await assignRoles(member.id, [support.id])
		expect(await service.listEffectivePermissions(member.id)).toEqual(["agents:read"])
		await updateRole(support.id, { name: "Helpdesk", permissions: [] })
		await seed.seed()
		expect(await service.listRoles()).toHaveLength(3)
		expect((await service.listRoles()).find(({ id }) => id === support.id)).toMatchObject({
			name: "Helpdesk",
			permissions: [],
			memberCount: 1,
		})
		expect(await service.listEffectivePermissions(member.id)).toEqual([])
	})

	it("creates, lists, updates and deletes a role", async () => {
		const member = await createMember()
		const created = await createRole(["agents:manage", "agents:read", "ai_provider:manage"], "  Support  ")
		await assignRoles(member.id, [created.id])

		expect(created).toEqual({
			id: created.id,
			name: "Support",
			permissions: ["ai_provider:manage", "agents:manage"],
			memberCount: 0,
		})
		expect(await service.listRoles()).toEqual([{ ...created, memberCount: 1 }])

		const updated = await updateRole(created.id, { name: "Helpdesk", permissions: ["agents:read"] })
		expect(updated).toEqual({ id: created.id, name: "Helpdesk", permissions: ["agents:read"], memberCount: 1 })

		await deleteRole(created.id)
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
		await expect(updateRole(other.id, { name: "support", permissions: [] })).rejects.toBeInstanceOf(
			service.DuplicateRoleNameError,
		)
		expect(await updateRole(existing.id, { name: "SUPPORT", permissions: [] })).toMatchObject({
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

		await expect(updateRole(missing, { name: "Gone", permissions: [] })).rejects.toBeInstanceOf(
			service.RoleNotFoundError,
		)
		await expect(deleteRole(missing)).rejects.toBeInstanceOf(service.RoleNotFoundError)
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
		await assignRoles(member.id, [support.id, sales.id])

		const assigned = await assignRoles(member.id, [sales.id, billing.id])

		expect(assigned).toEqual([
			{ id: billing.id, name: billing.name },
			{ id: sales.id, name: sales.name },
		])
	})

	it("rejects an unknown user, an unknown role and duplicate role ids without changing anything", async () => {
		const member = await createMember()
		const role = await createRole(["agents:read"])
		await assignRoles(member.id, [role.id])

		await expect(assignRoles(crypto.randomUUID(), [])).rejects.toBeInstanceOf(identity.UserNotFoundError)
		await expect(assignRoles(member.id, [crypto.randomUUID()])).rejects.toBeInstanceOf(service.RoleNotFoundError)
		await expect(assignRoles(member.id, [role.id, role.id])).rejects.toBeInstanceOf(service.InvalidRoleInputError)
		expect(await service.listEffectivePermissions(member.id)).toEqual(["agents:read"])
	})

	it("settles simultaneous identical assignments without a duplicate-key failure", async () => {
		const member = await createMember()
		const role = await createRole(["agents:read"])

		await Promise.all([assignRoles(member.id, [role.id]), assignRoles(member.id, [role.id])])

		expect(await service.listEffectivePermissions(member.id)).toEqual(["agents:read"])
	})

	it("concurrent replacements leave one requested role set, never their union", async () => {
		const member = await createMember()
		const first = await createRole(["agents:read"])
		const second = await createRole(["ai_provider:manage"])

		await Promise.all([assignRoles(member.id, [first.id]), assignRoles(member.id, [second.id])])

		const assigned = await repo.findRolesOfUser(member.id)
		expect(assigned).toHaveLength(1)
		expect(assigned.some(({ id }) => id === first.id || id === second.id)).toBe(true)
	})

	it("reports a role deleted between the check and the write as not found", async () => {
		const member = await createMember()
		const role = await createRole([])
		const missing = crypto.randomUUID()
		// Simulates the race: the existence check saw the role, then it was deleted before the insert.
		using _ = spyOn(repo, "findRolesByIds").mockResolvedValue([{ ...role, id: missing, createdAt: new Date() }])

		await expect(assignRoles(member.id, [missing])).rejects.toBeInstanceOf(service.RoleNotFoundError)
	})

	it("drops assignments when the user is deleted", async () => {
		const member = await createMember()
		const role = await createRole([])
		await assignRoles(member.id, [role.id])

		await identity.deleteAccount(member.id)

		const listed = (await service.listRoles()).find(({ id }) => id === role.id)
		expect(listed?.memberCount).toBe(0)
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

	it("reports missing targets before checking permissions in their requested changes", async () => {
		const manager = await memberWith(["roles:manage"])
		const powerful = await createRole(["ai_provider:manage"])

		await expectCode(
			await call(manager.cookie, "PUT", `/users/${crypto.randomUUID()}/roles`, { roleIds: [powerful.id] }),
			404,
			"user-not-found",
		)
		await expectCode(
			await call(manager.cookie, "PUT", `/roles/${crypto.randomUUID()}`, roleBody(["ai_provider:manage"])),
			404,
			"role-not-found",
		)
	})

	it("rechecks the caller's access when it was revoked after the request gate", async () => {
		const { cookie: adminCookie } = await createAdminSession()
		const manager = await memberWith(["roles:manage", "agents:read"])
		const checked = Promise.withResolvers<void>()
		const resume = Promise.withResolvers<void>()
		const original = service.listEffectivePermissions
		let paused = false
		using _ = spyOn(service, "listEffectivePermissions").mockImplementation(async (userId) => {
			const held = await original(userId)
			if (userId === manager.userId && !paused) {
				paused = true
				checked.resolve()
				await resume.promise
			}
			return held
		})

		const pending = call(manager.cookie, "POST", "/roles", roleBody(["agents:read"], "Revoked manager's role"))
		await checked.promise
		try {
			expect((await call(adminCookie, "PUT", `/users/${manager.userId}/roles`, { roleIds: [] })).status).toBe(200)
		} finally {
			resume.resolve()
		}

		await expectCode(await pending, 403, "permission-denied")
		expect((await service.listRoles()).some(({ name }) => name === "Revoked manager's role")).toBe(false)
	})

	it("refuses assigning or removing a role beyond the manager's permissions but leaves kept roles alone", async () => {
		const manager = await memberWith(["roles:manage", "agents:read"])
		const member = await createMember()
		const [powerful, reader] = await Promise.all([createRole(["ai_provider:manage"]), createRole(["agents:read"])])
		const assign = (roleIds: string[]) => call(manager.cookie, "PUT", `/users/${member.id}/roles`, { roleIds })

		await expectCode(await assign([powerful.id]), 403, "permission-exceeds-own")

		await assignRoles(member.id, [powerful.id])
		await expectCode(await assign([]), 403, "permission-exceeds-own")
		expect((await assign([powerful.id, reader.id])).status).toBe(200)
	})
})

describe("user management routes", () => {
	it("lists roles without exposing effective permissions or password-change state to users:read", async () => {
		const reader = await memberWith(["users:read"])
		const member = await createMember()
		const role = await createRole(["agents:manage"])
		await assignRoles(member.id, [role.id])

		const response = await call(reader.cookie, "GET", "/users")

		expect(response.status).toBe(200)
		const { users } = (await response.json()) as { users: service.UserWithAccess[] }
		expect(users.find(({ id }) => id === member.id)).toEqual({
			id: member.id,
			username: member.username,
			mustChangePassword: null,
			roles: [{ id: role.id, name: role.name }],
			isAdmin: false,
			canManage: false,
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

	it("refuses resetting or deleting the admin or a user with a role the manager lacks", async () => {
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
