import { db } from "@/db/client.ts"
import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm"

import { invitation, permissionGrant, role, rolePermission, userRole } from "./roles.schema.ts"

export type Invitation = typeof invitation.$inferSelect
export type NewInvitation = typeof invitation.$inferInsert
export type PermissionGrant = typeof permissionGrant.$inferSelect
export type NewPermissionGrant = typeof permissionGrant.$inferInsert
export type Role = typeof role.$inferSelect
export type RolePermission = typeof rolePermission.$inferSelect

export async function adminGrantExists(): Promise<boolean> {
	const [row] = await db
		.select({ id: permissionGrant.id })
		.from(permissionGrant)
		.where(and(eq(permissionGrant.permission, "admin"), isNull(permissionGrant.agentId)))
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

export async function deletePermissionGrant(id: string): Promise<void> {
	await db.delete(permissionGrant).where(eq(permissionGrant.id, id))
}

export async function findGrantsForUser(userId: string): Promise<PermissionGrant[]> {
	return db.select().from(permissionGrant).where(eq(permissionGrant.userId, userId))
}

export async function findRolePermissionsForUser(userId: string): Promise<{ permission: string }[]> {
	return db
		.selectDistinct({ permission: rolePermission.permission })
		.from(userRole)
		.innerJoin(rolePermission, eq(rolePermission.roleId, userRole.roleId))
		.where(eq(userRole.userId, userId))
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

export async function findPermissionsOfRoles(roleIds?: string[]): Promise<RolePermission[]> {
	if (roleIds?.length === 0) return []
	return db
		.select()
		.from(rolePermission)
		.where(roleIds ? inArray(rolePermission.roleId, roleIds) : undefined)
}

export async function countMembersByRole(roleIds?: string[]): Promise<{ memberCount: number; roleId: string }[]> {
	if (roleIds?.length === 0) return []
	return db
		.select({ roleId: userRole.roleId, memberCount: count() })
		.from(userRole)
		.where(roleIds ? inArray(userRole.roleId, roleIds) : undefined)
		.groupBy(userRole.roleId)
}

export async function findRolesOfUser(userId: string): Promise<Pick<Role, "id" | "name">[]> {
	return db
		.select({ id: role.id, name: role.name })
		.from(userRole)
		.innerJoin(role, eq(role.id, userRole.roleId))
		.where(eq(userRole.userId, userId))
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
