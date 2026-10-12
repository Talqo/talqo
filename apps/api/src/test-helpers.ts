import * as roles from "@/modules/roles/roles.service.ts"

export const DEFAULT_PASSWORD = "correct-horse-battery-staple"

export function uniqueUsername(): string {
	return `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
}

// Roles are the only way to give a non-admin user permissions.
export async function giveRole(userId: string, permissions: roles.GrantablePermission[]): Promise<void> {
	const role = await roles.createRole({ name: `Test role ${crypto.randomUUID()}`, permissions })
	await roles.assignRoles(userId, [role.id])
}
