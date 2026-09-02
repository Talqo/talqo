import { db } from "@/db/client.ts"
import { and, eq, gt, isNull } from "drizzle-orm"

import { invitation, permissionGrant } from "./roles.schema.ts"

export type Invitation = typeof invitation.$inferSelect
export type NewInvitation = typeof invitation.$inferInsert
export type PermissionGrant = typeof permissionGrant.$inferSelect
export type NewPermissionGrant = typeof permissionGrant.$inferInsert

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
