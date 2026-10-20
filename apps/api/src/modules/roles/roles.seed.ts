import type { GrantablePermission } from "./roles.service.ts"

import * as repo from "./roles.repository.ts"

const SEED_ROLES = [
	{ id: "44444444-4444-4444-8444-444444444441", name: "Support", permissions: ["agents:read", "conversations:read"] },
	{ id: "44444444-4444-4444-8444-444444444442", name: "Agent editors", permissions: ["agents:manage"] },
	{ id: "44444444-4444-4444-8444-444444444443", name: "Team managers", permissions: ["users:manage", "roles:manage"] },
] satisfies { id: string; name: string; permissions: GrantablePermission[] }[]

export async function seed(): Promise<void> {
	await repo.withAccessLock(async () => {
		const existing = await repo.findRoles()
		await Promise.all(
			SEED_ROLES.filter(
				(role) => !existing.some(({ id, name }) => id === role.id || name.toLowerCase() === role.name.toLowerCase()),
			).map(({ permissions, ...role }) => repo.insertRoleWithPermissions(role, permissions)),
		)
	})
}

export const hasAdmin = repo.adminGrantExists

export async function seedAdmin(userId: string): Promise<void> {
	await repo.insertPermissionGrant({
		id: crypto.randomUUID(),
		userId,
		permission: "admin",
		grantedBy: userId,
	})
}
