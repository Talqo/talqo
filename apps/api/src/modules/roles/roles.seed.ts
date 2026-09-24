import * as repo from "./roles.repository.ts"

export const hasAdmin = repo.adminGrantExists

export async function seedAdmin(userId: string): Promise<void> {
	await repo.insertPermissionGrant({
		id: crypto.randomUUID(),
		userId,
		permission: "admin",
		grantedBy: userId,
	})
}
