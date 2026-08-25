import { sql } from "@/db/client.ts"

import * as service from "./roles.service.ts"

export const SEED_ADMIN = { username: "admin", password: "admin123" } as const

export async function reset(): Promise<void> {
	await sql`TRUNCATE TABLE user_role, invitation, permission_grant`
}

// Natural first-deployment permissions: the operator runs agents and invitations,
// the viewer is read-only, and the fresh member intentionally has no grants.
export async function seed(userIds: { member: string; user: string; viewer: string }): Promise<void> {
	const admin = await service.bootstrapAdmin(SEED_ADMIN)
	await service.grantPermission({ userId: userIds.user, permission: "agents:read", grantedBy: admin.id })
	await service.grantPermission({ userId: userIds.user, permission: "agents:manage", grantedBy: admin.id })
	await service.grantPermission({ userId: userIds.user, permission: "users:invite", grantedBy: admin.id })
	await service.grantPermission({ userId: userIds.viewer, permission: "agents:read", grantedBy: admin.id })
}
