import { sql } from "@/db/client.ts"

import * as service from "./identity.service.ts"

// The admin account is seeded by the roles module (it owns the admin role row).
export const SEED_ACCOUNTS = {
	user: { username: "user", password: "user1234" },
	viewer: { username: "viewer", password: "viewer1234" },
	member: { username: "member", password: "member1234" },
} as const

export async function reset(): Promise<void> {
	// CASCADE is required: Postgres refuses to truncate `user` while roles' tables still reference it.
	await sql`TRUNCATE TABLE session, "user" CASCADE`
}

export async function seed(): Promise<Record<keyof typeof SEED_ACCOUNTS, string>> {
	const keys = Object.keys(SEED_ACCOUNTS) as (keyof typeof SEED_ACCOUNTS)[]
	const accounts = await Promise.all(keys.map((key) => service.createAccount(SEED_ACCOUNTS[key])))
	const entries = keys.map((key, index) => {
		const account = accounts[index]
		if (!account) throw new Error(`seed: no account created for ${key}`)
		return [key, account.id] as const
	})
	return Object.fromEntries(entries) as Record<keyof typeof SEED_ACCOUNTS, string>
}
