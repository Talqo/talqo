import { db } from "@/db/client.ts"
import { eq } from "drizzle-orm"

import { userRole } from "./roles.schema.ts"

export type UserRole = typeof userRole.$inferSelect
export type NewUserRole = typeof userRole.$inferInsert

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
