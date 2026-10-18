import * as repo from "./identity.repository.ts"
import * as service from "./identity.service.ts"

async function ensureUser(username: string, password: string): Promise<string> {
	const existing = await repo.findUserByUsername(username)
	if (existing) return existing.id
	return (await service.createUser({ username, password })).id
}

export async function seedAdmin(): Promise<string> {
	return ensureUser("admin", "admin123")
}

export async function seedUser(): Promise<void> {
	await ensureUser("user", "user1234")
}
