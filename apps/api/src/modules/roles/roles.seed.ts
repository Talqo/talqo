import type { GrantablePermission } from "./roles.service.ts"

import * as repo from "./roles.repository.ts"

const SEED_ROLES = [
	{ id: "44444444-4444-4444-8444-444444444441", name: "Support", permissions: [] },
	{ id: "44444444-4444-4444-8444-444444444442", name: "Agent editors", permissions: [] },
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

export async function seedAgentAccess(agentIds: readonly string[]): Promise<void> {
	await repo.withAccessLock(async () => {
		await Promise.all(
			agentIds.map(async (agentId) => {
				const existing = await repo.findAgentRolePermissions(agentId)
				await Promise.all(
					(
						[
							["44444444-4444-4444-8444-444444444441", ["stats:read", "conversations:read"]],
							["44444444-4444-4444-8444-444444444442", ["agents:manage"]],
						] as const
					)
						.filter(([roleId]) => !existing.some((grant) => grant.roleId === roleId))
						.map(([roleId, permissions]) => repo.replaceAgentRolePermissions(agentId, roleId, permissions)),
				)
			}),
		)
	})
}

export async function seedAdmin(userId: string): Promise<void> {
	await repo.insertPermissionGrant({
		id: crypto.randomUUID(),
		userId,
		permission: "admin",
		grantedBy: userId,
	})
}
