import type { AgentPermission, GrantablePermission } from "./roles.service.ts"

import * as repo from "./roles.repository.ts"

const SEED_ROLES = [
	{
		id: "44444444-4444-4444-8444-444444444441",
		name: "Support",
		permissions: [],
		agentPermissions: ["stats:read", "conversations:read"],
	},
	{
		id: "44444444-4444-4444-8444-444444444442",
		name: "Agent editors",
		permissions: [],
		agentPermissions: ["agents:manage"],
	},
	{
		id: "44444444-4444-4444-8444-444444444443",
		name: "Team managers",
		permissions: ["users:manage", "roles:manage"],
		agentPermissions: [],
	},
] satisfies { id: string; name: string; permissions: GrantablePermission[]; agentPermissions: AgentPermission[] }[]

export async function seed(): Promise<void> {
	await repo.withAccessLock(async () => {
		const existing = await repo.findRoles()
		await Promise.all(
			SEED_ROLES.filter(
				(role) => !existing.some(({ id, name }) => id === role.id || name.toLowerCase() === role.name.toLowerCase()),
			).map(({ id, name, permissions }) => repo.insertRoleWithPermissions({ id, name }, permissions)),
		)
	})
}

export const hasAdmin = repo.adminGrantExists

export async function seedAgentAccess(agentIds: readonly string[]): Promise<void> {
	await repo.withAccessLock(async () => {
		const roles = await repo.findRoles()
		await Promise.all(
			agentIds.map(async (agentId) => {
				const existing = await repo.findAgentRolePermissions(agentId)
				await Promise.all(
					SEED_ROLES.filter(({ agentPermissions }) => agentPermissions.length > 0)
						.map(({ id, name, agentPermissions }) => {
							const role =
								roles.find((candidate) => candidate.id === id) ??
								roles.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())
							if (!role) throw new Error(`seedAgentAccess: missing role ${name}`)
							return { roleId: role.id, permissions: agentPermissions }
						})
						.filter(({ roleId }) => !existing.some((grant) => grant.roleId === roleId))
						.map(({ roleId, permissions }) => repo.replaceAgentRolePermissions(agentId, roleId, permissions)),
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
