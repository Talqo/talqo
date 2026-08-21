import { getDb } from "@/db/client.ts"
import { eq } from "drizzle-orm"

import { session, user } from "./identity.schema.ts"

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert
export type Session = typeof session.$inferSelect
export type NewSession = typeof session.$inferInsert

export async function insertUser(values: NewUser): Promise<User> {
	const db = getDb()
	const [row] = await db.insert(user).values(values).returning()
	if (!row) throw new Error("insertUser: insert returned no row")
	return row
}

export async function findUserByUsername(username: string): Promise<User | undefined> {
	const db = getDb()
	const [row] = await db.select().from(user).where(eq(user.username, username))
	return row
}

export async function findUserById(id: string): Promise<User | undefined> {
	const db = getDb()
	const [row] = await db.select().from(user).where(eq(user.id, id))
	return row
}

export async function updateUser(id: string, values: Partial<Pick<NewUser, "username">>): Promise<User | undefined> {
	const db = getDb()
	const [row] = await db
		.update(user)
		.set({ ...values, updatedAt: new Date() })
		.where(eq(user.id, id))
		.returning()
	return row
}

export async function updatePasswordHash(id: string, passwordHash: string): Promise<void> {
	const db = getDb()
	await db.update(user).set({ passwordHash, updatedAt: new Date() }).where(eq(user.id, id))
}

export async function deleteUser(id: string): Promise<void> {
	const db = getDb()
	await db.delete(user).where(eq(user.id, id))
}

export async function insertSession(values: NewSession): Promise<Session> {
	const db = getDb()
	const [row] = await db.insert(session).values(values).returning()
	if (!row) throw new Error("insertSession: insert returned no row")
	return row
}

export async function findSessionByTokenHash(tokenHash: string): Promise<{ session: Session; user: User } | undefined> {
	const db = getDb()
	const [row] = await db
		.select({ session, user })
		.from(session)
		.innerJoin(user, eq(session.userId, user.id))
		.where(eq(session.tokenHash, tokenHash))
	return row
}

export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
	const db = getDb()
	await db.delete(session).where(eq(session.tokenHash, tokenHash))
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
	const db = getDb()
	await db.delete(session).where(eq(session.userId, userId))
}
