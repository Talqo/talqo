import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { describe, expect, it } from "bun:test"

import * as repo from "./roles.repository.ts"
import * as service from "./roles.service.ts"

function uniqueUsername(): string {
	return `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
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
