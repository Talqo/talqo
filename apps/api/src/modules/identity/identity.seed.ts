import * as repo from "./identity.repository.ts"
import * as service from "./identity.service.ts"

async function seedAccount(username: string, password: string): Promise<string> {
	const existing = await repo.findUserByUsername(username)
	if (existing) return existing.id
	return (await service.createAccount({ username, password })).id
}

export async function seedAdmin(): Promise<string> {
	return seedAccount("admin", "admin123")
}

export async function seedUser(): Promise<void> {
	await seedAccount("user", "user1234")
}
