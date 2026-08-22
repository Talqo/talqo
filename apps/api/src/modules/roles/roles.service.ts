import type { PublicUser } from "@/modules/identity/identity.service.ts"

import { generateOpaqueToken, hashOpaqueToken } from "@/lib/opaque-token.ts"
import { isUniqueViolation } from "@/lib/pg-error.ts"
import * as identity from "@/modules/identity/identity.service.ts"

import * as repo from "./roles.repository.ts"

// eslint-disable-next-line no-magic-numbers
const INVITATION_DURATION_MS = 1000 * 60 * 60 * 24 * 7

export const PUBLIC_PATHS = ["/setup", "/invitations/redeem"]

export const PERMISSIONS = ["users:invite", "ai_provider:manage", "agents:read", "agents:manage"] as const
export type Permission = (typeof PERMISSIONS)[number]

// Mutating grants imply read access to the same capability; keep this a DAG, never a cycle.
const IMPLIED_BY: Partial<Record<Permission, Permission[]>> = {
	"agents:manage": ["agents:read"],
}

export type PermissionGrant = {
	grantedAt: Date
	grantedBy: string | null
	id: string
	permission: Permission
	userId: string
}

function expandPermissions(granted: Permission[]): Permission[] {
	const effective = new Set<Permission>(granted)
	for (const permission of granted) {
		for (const implied of IMPLIED_BY[permission] ?? []) effective.add(implied)
	}
	return PERMISSIONS.filter((permission) => effective.has(permission))
}

export function effectivePermissions(adminStatus: boolean, grants: { permission: string }[]): Permission[] {
	if (adminStatus) return [...PERMISSIONS]
	return expandPermissions(grants.map((grant) => grant.permission as Permission))
}

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

export async function grantPermission(input: {
	grantedBy: string
	permission: Permission
	userId: string
}): Promise<PermissionGrant> {
	const row = await repo.insertPermissionGrant({
		id: crypto.randomUUID(),
		userId: input.userId,
		permission: input.permission,
		grantedBy: input.grantedBy,
	})
	return { ...row, permission: input.permission }
}

export async function revokePermission(id: string): Promise<void> {
	await repo.deletePermissionGrant(id)
}

// Pure and synchronous by design: the authorization decision lives in one small,
// fully auditable function, separate from where the grants get fetched.
export function can(user: { isAdmin: boolean }, grants: { permission: string }[], permission: Permission): boolean {
	return effectivePermissions(user.isAdmin, grants).includes(permission)
}

export async function getAccess(userId: string): Promise<{ isAdmin: boolean; permissions: Permission[] }> {
	const [adminStatus, grants] = await Promise.all([isAdmin(userId), repo.findGrantsForUser(userId)])
	return { isAdmin: adminStatus, permissions: effectivePermissions(adminStatus, grants) }
}

export async function authorize(userId: string, permission: Permission): Promise<boolean> {
	// Fetched fresh on every call, never cached -- a revoked grant denies the very next
	// request without needing to touch the user's session (see ADR-0008).
	const [adminStatus, grants] = await Promise.all([isAdmin(userId), repo.findGrantsForUser(userId)])
	return can({ isAdmin: adminStatus }, grants, permission)
}

export async function listEffectivePermissions(userId: string): Promise<Permission[]> {
	const [adminStatus, grants] = await Promise.all([isAdmin(userId), repo.findGrantsForUser(userId)])
	return effectivePermissions(adminStatus, grants)
}
