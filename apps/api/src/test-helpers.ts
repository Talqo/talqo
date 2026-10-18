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

export async function giveRole(userId: string, permissions: roles.GrantablePermission[]): Promise<void> {
	const adminId = await testAdminId()
	const role = await roles.createRole({ name: `Test role ${crypto.randomUUID()}`, permissions }, adminId)
	await roles.assignRoles(userId, [role.id], adminId)
}
