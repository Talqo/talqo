import { sql } from "@/db/client.ts"

import * as service from "./identity.service.ts"

/**
 * Deliberately not an admin: `roles.hasAdmin()` reads `user_role`, so leaving this
 * account role-less keeps `GET /api/setup` reporting `needsSetup: true` and lets the
 * auth-flow E2E journey still exercise first-run admin bootstrap. Its dashboard
 * access comes from an explicit `agents:write` grant instead.
 */
export const E2E_OPERATOR = {
	username: "e2e_operator",
	password: "correct-horse-battery-staple",
} as const

export async function reset(): Promise<void> {
	// CASCADE is required: Postgres refuses to truncate `user` while roles' tables still reference it.
	await sql`TRUNCATE TABLE session, "user" CASCADE`
}

export async function seed(): Promise<{ userId: string }> {
	const user = await service.createAccount({ username: E2E_OPERATOR.username, password: E2E_OPERATOR.password })
	return { userId: user.id }
}
