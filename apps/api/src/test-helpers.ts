import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { expect } from "bun:test"

export const DEFAULT_PASSWORD = "correct-horse-battery-staple"

export function uniqueUsername(): string {
	return `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
}

export async function login(username: string, password = DEFAULT_PASSWORD): Promise<string> {
	const response = await app.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password }),
	})
	return sessionCookieFrom(response)
}

export function sessionCookieFrom(response: Response): string {
	const setCookie = response.headers.get("set-cookie")
	if (!setCookie) throw new Error("Expected a Set-Cookie header")
	const [cookiePair] = setCookie.split(";")
	if (!cookiePair) throw new Error("Malformed Set-Cookie header")
	return cookiePair
}

export async function expectConcealedResource(userId: string, hiddenPath: string, missingPath: string): Promise<void> {
	const { token } = await identity.createSession(userId)
	const headers = { Cookie: `${identity.SESSION_COOKIE}=${token}` }
	const hiddenResponse = await app.request(hiddenPath, { headers })
	const missingResponse = await app.request(missingPath, { headers })
	expect(hiddenResponse.status).toBe(404)
	expect(missingResponse.status).toBe(404)
	expect(await hiddenResponse.json()).toEqual(await missingResponse.json())
}

export async function createAdminSession(): Promise<{ cookie: string; userId: string }> {
	const username = uniqueUsername()
	const admin = await roles.bootstrapAdmin({ username, password: DEFAULT_PASSWORD })
	return { cookie: await login(username), userId: admin.id }
}

export async function testAdminId(): Promise<string> {
	const [admin] = await sql<{ user_id: string }[]>`SELECT user_id FROM permission_grant WHERE permission = 'admin'`
	if (admin) return admin.user_id
	return (await roles.bootstrapAdmin({ username: uniqueUsername(), password: DEFAULT_PASSWORD })).id
}

export async function giveRole(
	userId: string,
	permissions: (roles.GrantablePermission | roles.AgentPermission)[],
	agentIds?: string[],
): Promise<void> {
	const adminId = await testAdminId()
	const globalPermissions = permissions.filter((permission): permission is roles.GrantablePermission =>
		(roles.GRANTABLE_PERMISSIONS as readonly string[]).includes(permission),
	)
	const scopedPermissions = permissions.filter((permission): permission is roles.AgentPermission =>
		(roles.AGENT_PERMISSIONS as readonly string[]).includes(permission),
	)
	const role = await roles.createRole(
		{ name: `Test role ${crypto.randomUUID()}`, permissions: globalPermissions },
		adminId,
	)
	if (scopedPermissions.length > 0) {
		const ids = agentIds ?? (await sql<{ id: string }[]>`SELECT id FROM agent`).map(({ id }) => id)
		await Promise.all(ids.map((agentId) => roles.setRoleAgentAccess(adminId, role.id, agentId, scopedPermissions)))
	}
	await roles.assignRoles(userId, [role.id], adminId)
}
