import { generateOpaqueToken, hashOpaqueToken } from "@/lib/opaque-token.ts"
import {
	CREDENTIAL_MAX_LENGTH,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	USERNAME_PATTERN,
} from "@talqo/shared"

import type { User } from "./identity.repository.ts"

import * as repo from "./identity.repository.ts"

// eslint-disable-next-line no-magic-numbers
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7

// Real argon2id hash with no account, checked on unknown usernames so timing doesn't leak existence.
const DUMMY_PASSWORD_HASH =
	"$argon2id$v=19$m=65536,t=2,p=1$w3rYKVUc1fpKckt77EcQqRf6du84Qh6GiLBmosTOV8M$SSJe6OCOtUC+ZpVOYRQ0/3VJER6dG7vPZxSEIXWyTAs"

export const SESSION_COOKIE = "session"
export const PUBLIC_AUTH_PATHS = ["/auth/login", "/auth/session", "/auth/logout"]

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN }

export class InvalidCredentialsError extends Error {}
export class InvalidPasswordError extends Error {}
export class InvalidUsernameError extends Error {}
export class InvalidPasswordFormatError extends Error {}
export class UserNotFoundError extends Error {}
export class PasswordChangeNotRequiredError extends Error {}

export type PublicUser = Pick<User, "id" | "mustChangePassword" | "username">

export function toPublicUser(user: User): PublicUser {
	return { id: user.id, username: user.username, mustChangePassword: user.mustChangePassword }
}

export function assertValidUsername(username: string): void {
	if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
		throw new InvalidUsernameError(
			`Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters`,
		)
	}
	if (!USERNAME_PATTERN.test(username)) {
		throw new InvalidUsernameError("Username may only contain letters, numbers, underscores, and hyphens")
	}
}

export function assertValidPassword(password: string): void {
	if (password.length < PASSWORD_MIN_LENGTH || Buffer.byteLength(password, "utf8") > PASSWORD_MAX_LENGTH) {
		throw new InvalidPasswordFormatError(
			`Password must be at least ${PASSWORD_MIN_LENGTH} characters and at most ${PASSWORD_MAX_LENGTH} bytes long`,
		)
	}
}

export async function createAccount(input: { password: string; username: string }): Promise<PublicUser> {
	assertValidUsername(input.username)
	assertValidPassword(input.password)
	const passwordHash = await Bun.password.hash(input.password)
	const user = await repo.insertUser({
		id: crypto.randomUUID(),
		username: input.username,
		passwordHash,
	})
	return toPublicUser(user)
}

export async function login(
	input: { password: string; username: string },
	context: { ipAddress?: string; userAgent?: string } = {},
): Promise<{ expiresAt: Date; token: string; user: PublicUser }> {
	const user = await repo.findUserByUsername(input.username)
	// Cap before verify: the supplied password is memory-hard-hashed even for unknown users.
	const passwordOversized = Buffer.byteLength(input.password, "utf8") > CREDENTIAL_MAX_LENGTH
	const passwordValid =
		!passwordOversized && (await Bun.password.verify(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH))

	if (!user || !passwordValid) {
		throw new InvalidCredentialsError("Invalid username or password")
	}

	const token = generateOpaqueToken()
	const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)
	await repo.insertSession({
		id: crypto.randomUUID(),
		tokenHash: hashOpaqueToken(token),
		userId: user.id,
		expiresAt,
		ipAddress: context.ipAddress,
		userAgent: context.userAgent,
	})

	return { token, expiresAt, user: toPublicUser(user) }
}

export async function logout(token: string): Promise<void> {
	await repo.deleteSessionByTokenHash(hashOpaqueToken(token))
}

export async function getSession(token: string): Promise<{ expiresAt: Date; user: PublicUser } | null> {
	const tokenHash = hashOpaqueToken(token)
	const row = await repo.findSessionByTokenHash(tokenHash)
	if (!row) return null

	if (row.session.expiresAt.getTime() <= Date.now()) {
		// Opportunistic purge: an expired session is dead weight the moment it's read, so
		// clean it up here instead of leaving it for a separate cleanup job that doesn't exist.
		await repo.deleteSessionByTokenHash(tokenHash)
		return null
	}

	return { user: toPublicUser(row.user), expiresAt: row.session.expiresAt }
}

async function rotatePassword(userId: string, newPassword: string, mustChangePassword: boolean): Promise<void> {
	assertValidPassword(newPassword)
	const passwordHash = await Bun.password.hash(newPassword)
	await repo.updatePasswordHash(userId, passwordHash, mustChangePassword)
	await repo.deleteAllSessionsForUser(userId)
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
	const user = await repo.findUserById(userId)
	if (!user) throw new UserNotFoundError(`changePassword: user ${userId} not found`)

	// Cap before verify: currentPassword is attacker-controlled yet memory-hard-hashed.
	if (Buffer.byteLength(currentPassword, "utf8") > CREDENTIAL_MAX_LENGTH) {
		throw new InvalidPasswordError("Current password is incorrect")
	}
	const currentValid = await Bun.password.verify(currentPassword, user.passwordHash)
	if (!currentValid) throw new InvalidPasswordError("Current password is incorrect")

	await rotatePassword(userId, newPassword, false)
}

// Skips the current-password proof: safe only because mustChangePassword is server-set, never caller-set.
export async function completeForcedPasswordChange(userId: string, newPassword: string): Promise<void> {
	const user = await repo.findUserById(userId)
	if (!user) throw new UserNotFoundError(`completeForcedPasswordChange: user ${userId} not found`)
	if (!user.mustChangePassword) {
		throw new PasswordChangeNotRequiredError("No password change is currently required")
	}

	await rotatePassword(userId, newPassword, false)
}

// An admin knowing this password should never be a durable state, hence mustChangePassword=true.
export async function setPassword(userId: string, newPassword: string): Promise<void> {
	const user = await repo.findUserById(userId)
	if (!user) throw new UserNotFoundError(`setPassword: user ${userId} not found`)

	await rotatePassword(userId, newPassword, true)
}

export async function listUsers(): Promise<PublicUser[]> {
	const users = await repo.listUsers()
	return users.map(toPublicUser)
}

export async function updateAccount(userId: string, input: { username: string }): Promise<PublicUser> {
	assertValidUsername(input.username)
	const user = await repo.updateUser(userId, input)
	if (!user) throw new UserNotFoundError(`updateAccount: user ${userId} not found`)
	return toPublicUser(user)
}

export async function deleteAccount(userId: string): Promise<void> {
	await repo.deleteUser(userId)
}
