import { sql } from "@/db/client.ts"
import * as roles from "@/modules/roles/roles.service.ts"

export const DEFAULT_PASSWORD = "correct-horse-battery-staple"

export function uniqueUsername(): string {
	return `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
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
		await Promise.all(ids.map((agentId) => roles.setAgentAccess(adminId, agentId, role.id, scopedPermissions)))
	}
	await roles.assignRoles(userId, [role.id], adminId)
}
