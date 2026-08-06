import { db } from "@/db/client.ts"
import { and, eq, gt, isNull } from "drizzle-orm"

import { invitation, userRole } from "./roles.schema.ts"

export type UserRole = typeof userRole.$inferSelect
export type NewUserRole = typeof userRole.$inferInsert
export type Invitation = typeof invitation.$inferSelect
export type NewInvitation = typeof invitation.$inferInsert

export async function adminExists(): Promise<boolean> {
	const [row] = await db.select({ id: userRole.id }).from(userRole).where(eq(userRole.role, "admin")).limit(1)
	return row !== undefined
}

export async function insertUserRole(values: NewUserRole): Promise<UserRole> {
	const [row] = await db.insert(userRole).values(values).returning()
	if (!row) throw new Error("insertUserRole: insert returned no row")
	return row
}

export async function findRoleForUser(userId: string): Promise<UserRole["role"] | undefined> {
	const [row] = await db.select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, userId))
	return row?.role
}

export async function insertInvitation(values: NewInvitation): Promise<Invitation> {
	const [row] = await db.insert(invitation).values(values).returning()
	if (!row) throw new Error("insertInvitation: insert returned no row")
	return row
}

export async function claimInvitation(tokenHash: string): Promise<Invitation | undefined> {
	// A conditional UPDATE, not a read-then-write: Postgres's row lock makes this the
	// atomic single-use claim, so two concurrent redemptions of the same token can't both
	// succeed.
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
