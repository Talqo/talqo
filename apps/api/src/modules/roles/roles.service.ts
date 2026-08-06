import type { PublicUser } from "@/modules/identity/identity.service.ts"

import { isUniqueViolation } from "@/lib/pg-error.ts"
import * as identity from "@/modules/identity/identity.service.ts"

import * as repo from "./roles.repository.ts"

export const PUBLIC_SETUP_PATHS = ["/api/setup"]

export class AdminAlreadyExistsError extends Error {}

export async function hasAdmin(): Promise<boolean> {
	return repo.adminExists()
}

export async function bootstrapAdmin(input: { password: string; username: string }): Promise<PublicUser> {
	if (await repo.adminExists()) {
		throw new AdminAlreadyExistsError("An admin account already exists")
	}

	const user = await identity.createAccount(input)
	try {
		await repo.insertUserRole({ id: crypto.randomUUID(), userId: user.id, role: "admin" })
	} catch (error) {
		// Undo the just-created account so a lost race for "first admin" doesn't leave a
		// permanently orphaned, role-less account occupying that username.
		await identity.deleteAccount(user.id)
		if (isUniqueViolation(error)) throw new AdminAlreadyExistsError("An admin account already exists")
		throw error
	}

	return user
}

export async function isAdmin(userId: string): Promise<boolean> {
	return (await repo.findRoleForUser(userId)) === "admin"
}
