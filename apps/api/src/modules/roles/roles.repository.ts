import { db, sql as client } from "@/db/client.ts"
import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm"
import { union } from "drizzle-orm/pg-core"

import { invitation, permissionGrant, role, rolePermission, userRole } from "./roles.schema.ts"

export type Invitation = typeof invitation.$inferSelect
export type NewInvitation = typeof invitation.$inferInsert
export type PermissionGrant = typeof permissionGrant.$inferSelect
export type NewPermissionGrant = typeof permissionGrant.$inferInsert
export type Role = typeof role.$inferSelect
export type RolePermission = typeof rolePermission.$inferSelect

let accessChanges = Promise.resolve()

// Queue locally so waiting for the deployment-wide lock cannot exhaust the main connection pool.
export function withAccessLock<T>(change: () => Promise<T>): Promise<T> {
	const pending = accessChanges.then(async () => {
		const connection = await client.reserve()
		try {
			await connection`SELECT pg_advisory_lock(hashtextextended('talqo:access-management', 0))`
			try {
				return await change()
			} finally {
				await connection`SELECT pg_advisory_unlock(hashtextextended('talqo:access-management', 0))`
			}
		} finally {
			connection.release()
		}
	})
	accessChanges = pending.then(
		() => undefined,
		() => undefined,
	)
	return pending
}

export async function adminGrantExists(): Promise<boolean> {
	const [row] = await db
		.select({ id: permissionGrant.id })
		.from(permissionGrant)
		.where(eq(permissionGrant.permission, "admin"))
		.limit(1)
	return row !== undefined
}

export async function insertInvitation(values: NewInvitation): Promise<Invitation> {
	const [row] = await db.insert(invitation).values(values).returning()
	if (!row) throw new Error("insertInvitation: insert returned no row")
	return row
}

export async function claimInvitation(tokenHash: string): Promise<Invitation | undefined> {
	// Conditional UPDATE, not read-then-write: Postgres's row lock makes this an atomic single-use claim.
	const [row] = await db
		.update(invitation)
		.set({ redeemedAt: new Date() })
		.where(
			and(eq(invitation.tokenHash, tokenHash), isNull(invitation.redeemedAt), gt(invitation.expiresAt, new Date())),
		)
		.returning()
	return row
}

export async function unclaimInvitation(id: string): Promise<void> {
	await db.update(invitation).set({ redeemedAt: null }).where(eq(invitation.id, id))
}

export async function insertPermissionGrant(values: NewPermissionGrant): Promise<PermissionGrant> {
	const [row] = await db.insert(permissionGrant).values(values).returning()
	if (!row) throw new Error("insertPermissionGrant: insert returned no row")
	return row
}

export async function findPermissionsForUsers(userIds: string[]): Promise<{ userId: string; permission: string }[]> {
	if (userIds.length === 0) return []
	return union(
		db
			.select({ userId: permissionGrant.userId, permission: permissionGrant.permission })
			.from(permissionGrant)
			.where(inArray(permissionGrant.userId, userIds)),
		db
			.select({ userId: userRole.userId, permission: rolePermission.permission })
			.from(userRole)
			.innerJoin(rolePermission, eq(rolePermission.roleId, userRole.roleId))
			.where(inArray(userRole.userId, userIds)),
	)
}

export async function findRoles(): Promise<Role[]> {
	return db
		.select()
		.from(role)
		.orderBy(sql`lower(${role.name})`)
}

export async function findRoleById(id: string): Promise<Role | undefined> {
	const [row] = await db.select().from(role).where(eq(role.id, id)).limit(1)
	return row
}

export async function findRolesByIds(ids: string[]): Promise<Role[]> {
	if (ids.length === 0) return []
	return db.select().from(role).where(inArray(role.id, ids))
}

export async function findPermissionsOfRoles(roleIds: string[]): Promise<RolePermission[]> {
	if (roleIds.length === 0) return []
	return db.select().from(rolePermission).where(inArray(rolePermission.roleId, roleIds))
}

export async function countMembersByRole(roleIds: string[]): Promise<{ memberCount: number; roleId: string }[]> {
	if (roleIds.length === 0) return []
	return db
		.select({ roleId: userRole.roleId, memberCount: count() })
		.from(userRole)
		.where(inArray(userRole.roleId, roleIds))
		.groupBy(userRole.roleId)
}

export async function findRolesOfUser(userId: string): Promise<Pick<Role, "id" | "name">[]> {
	return (await findRolesOfUsers([userId])).map(({ id, name }) => ({ id, name }))
}

export async function findRolesOfUsers(userIds: string[]): Promise<{ userId: string; id: string; name: string }[]> {
	if (userIds.length === 0) return []
	return db
		.select({ userId: userRole.userId, id: role.id, name: role.name })
		.from(userRole)
		.innerJoin(role, eq(role.id, userRole.roleId))
		.where(inArray(userRole.userId, userIds))
		.orderBy(sql`lower(${role.name})`)
}

// Role and permissions atomically: a permission failure must not leave a bare role.
export async function insertRoleWithPermissions(
	values: { id: string; name: string },
	permissions: string[],
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.insert(role).values(values)
		if (permissions.length > 0) {
			await tx.insert(rolePermission).values(permissions.map((permission) => ({ roleId: values.id, permission })))
		}
	})
}

export async function updateRoleWithPermissions(id: string, name: string, permissions: string[]): Promise<boolean> {
	return db.transaction(async (tx) => {
		const updated = await tx.update(role).set({ name }).where(eq(role.id, id)).returning({ id: role.id })
		if (updated.length === 0) return false
		await tx.delete(rolePermission).where(eq(rolePermission.roleId, id))
		if (permissions.length > 0) {
			await tx.insert(rolePermission).values(permissions.map((permission) => ({ roleId: id, permission })))
		}
		return true
	})
}

export async function deleteRoleById(id: string): Promise<boolean> {
	const rows = await db.delete(role).where(eq(role.id, id)).returning({ id: role.id })
	return rows.length > 0
}

export async function replaceUserRoles(userId: string, roleIds: string[]): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.delete(userRole).where(eq(userRole.userId, userId))
		if (roleIds.length > 0) {
			await tx.insert(userRole).values(roleIds.map((roleId) => ({ userId, roleId })))
		}
	})
}
