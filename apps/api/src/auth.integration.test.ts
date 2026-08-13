import { describe, expect, it } from "bun:test"

import { app } from "./app.ts"
import { sql } from "./db/client.ts"

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

describe("auth flow", () => {
	it("bootstraps an admin, invites and grants a member, then revokes access via password reset", async () => {
		await sql`TRUNCATE TABLE user_role`

		// 1. Bootstrap the sole admin.
		const adminUsername = uniqueUsername()
		const adminPassword = "correct-horse-battery-staple"
		const bootstrapResponse = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: adminUsername, password: adminPassword }),
		})
		expect(bootstrapResponse.status).toBe(201)
		const adminCookie = await signIn(adminUsername, adminPassword)

		// 2. Admin invites a member.
		const inviteResponse = await app.request("/api/invitations", {
			method: "POST",
			headers: { Cookie: adminCookie },
		})
		expect(inviteResponse.status).toBe(201)
		const { token } = (await inviteResponse.json()) as { token: string }

		// 3. Member redeems the invitation and logs in.
		const memberUsername = uniqueUsername()
		const memberPassword = "member-original-password-123"
		const redeemResponse = await app.request("/api/invitations/redeem", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token, username: memberUsername, password: memberPassword }),
		})
		expect(redeemResponse.status).toBe(201)
		const { user: member } = (await redeemResponse.json()) as { user: { id: string; username: string } }
		const memberCookie = await signIn(memberUsername, memberPassword)

		// Before any grant, the member has no elevated access at all.
		const beforeGrant = await app.request("/api/invitations", { method: "POST", headers: { Cookie: memberCookie } })
		expect(beforeGrant.status).toBe(403)

		// 4. Admin grants the member `users:invite`.
		const grantResponse = await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: member.id, permission: "users:invite" }),
		})
		expect(grantResponse.status).toBe(201)

		// 5. Member's access reflects exactly that grant: granted action succeeds, uncovered admin-only actions still fail.
		const afterGrant = await app.request("/api/invitations", { method: "POST", headers: { Cookie: memberCookie } })
		expect(afterGrant.status).toBe(201)

		const memberTriesToGrant = await app.request("/api/permission-grants", {
			method: "POST",
			headers: { Cookie: memberCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: member.id, permission: "users:invite" }),
		})
		expect(memberTriesToGrant.status).toBe(403)

		const memberTriesToResetOwnPassword = await app.request(`/api/users/${member.id}/password`, {
			method: "PATCH",
			headers: { Cookie: memberCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "member-attempted-self-reset" }),
		})
		expect(memberTriesToResetOwnPassword.status).toBe(403)

		// 6. Admin resets the member's password.
		const resetResponse = await app.request(`/api/users/${member.id}/password`, {
			method: "PATCH",
			headers: { Cookie: adminCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ newPassword: "member-reset-password-456" }),
		})
		expect(resetResponse.status).toBe(204)

		// 7. The member's pre-reset session is dead, even though it was never explicitly
		// signed out -- the reset alone invalidated it.
		const staleSession = await app.request("/api/auth/session", { headers: { Cookie: memberCookie } })
		expect(await staleSession.json()).toEqual({ user: null })

		const oldPasswordAttempt = await app.request("/api/auth/sign-in", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: memberUsername, password: memberPassword }),
		})
		expect(oldPasswordAttempt.status).toBe(401)

		const relogin = await app.request("/api/auth/sign-in", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: memberUsername, password: "member-reset-password-456" }),
		})
		expect(relogin.status).toBe(200)
	})
})
