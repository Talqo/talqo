import type { PublicUser } from "@/modules/identity/identity.service.ts"

import { generateOpaqueToken, hashOpaqueToken } from "@/lib/opaque-token.ts"
import { isUniqueViolation } from "@/lib/pg-error.ts"
import * as identity from "@/modules/identity/identity.service.ts"

import * as repo from "./roles.repository.ts"

const INVITATION_DURATION_MS = 1000 * 60 * 60 * 24 * 7

export const PUBLIC_PATHS = ["/api/setup", "/api/invitations/redeem"]

export class AdminAlreadyExistsError extends Error {}
export class InvalidInvitationError extends Error {}

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

export async function createInvitation(invitedBy: string): Promise<{ expiresAt: Date; token: string }> {
	const token = generateOpaqueToken()
	const expiresAt = new Date(Date.now() + INVITATION_DURATION_MS)
	await repo.insertInvitation({
		id: crypto.randomUUID(),
		tokenHash: hashOpaqueToken(token),
		invitedBy,
		expiresAt,
	})
	return { token, expiresAt }
}

export async function redeemInvitation(input: {
	password: string
	token: string
	username: string
}): Promise<PublicUser> {
	const claimed = await repo.claimInvitation(hashOpaqueToken(input.token))
	if (!claimed) throw new InvalidInvitationError("Invitation is invalid, expired, or already used")

	try {
		return await identity.createAccount({ username: input.username, password: input.password })
	} catch (error) {
		// A recoverable failure (e.g. username taken) shouldn't burn a single-use invite --
		// give the same link back its claim so the invitee can retry with a different username.
		await repo.unclaimInvitation(claimed.id)
		throw error
	}
}
