import type { PublicUser } from "@/modules/identity/identity.service.ts"

import { generateOpaqueToken, hashOpaqueToken } from "@/lib/opaque-token.ts"
import { isUniqueViolation } from "@/lib/pg-error.ts"
import * as identity from "@/modules/identity/identity.service.ts"

import * as repo from "./roles.repository.ts"

// eslint-disable-next-line no-magic-numbers
const INVITATION_DURATION_MS = 1000 * 60 * 60 * 24 * 7

export const PUBLIC_PATHS = ["/setup", "/invitations/redeem"]

export const PERMISSIONS = ["admin", "users:invite", "ai_provider:manage", "agents:read", "agents:manage"] as const
export type Permission = (typeof PERMISSIONS)[number]

// "admin" is the first entry only for display stability; it implies every other permission.
const IMPLIED_BY: Partial<Record<Permission, Permission[]>> = {
	admin: PERMISSIONS.filter((permission) => permission !== "admin"),
	// Mutating grants imply read access to the same capability; keep this a DAG, never a cycle.
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

type AuthorizationGrant = { agentId?: string | null; permission: string }

export function effectivePermissions(grants: AuthorizationGrant[]): Permission[] {
	return expandPermissions(
		grants.filter((grant) => grant.agentId == null).map((grant) => grant.permission as Permission),
	)
}

export class AdminAlreadyExistsError extends Error {}
export class InvalidInvitationError extends Error {}

export async function hasAdmin(): Promise<boolean> {
	return repo.adminGrantExists()
}

export async function bootstrapAdmin(input: { password: string; username: string }): Promise<PublicUser> {
	if (await repo.adminGrantExists()) {
		throw new AdminAlreadyExistsError("An admin account already exists")
	}

	const user = await identity.createAccount(input)
	try {
		await repo.insertPermissionGrant({
			id: crypto.randomUUID(),
			userId: user.id,
			permission: "admin",
			grantedBy: user.id,
		})
	} catch (error) {
		// Undo the just-created account so a lost race for "first admin" doesn't leave a
		// permanently orphaned, grant-less account occupying that username.
		await identity.deleteAccount(user.id)
		if (isUniqueViolation(error)) throw new AdminAlreadyExistsError("An admin account already exists")
		throw error
	}

	return user
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
export function can(grants: AuthorizationGrant[], permission: Permission): boolean {
	return effectivePermissions(grants).includes(permission)
}

export async function getAccess(userId: string): Promise<{ permissions: Permission[] }> {
	return { permissions: await listEffectivePermissions(userId) }
}

export async function authorize(userId: string, permission: Permission): Promise<boolean> {
	// Fetched fresh on every call, never cached -- a revoked grant denies the very next
	// request without needing to touch the user's session (see ADR-0008/0009).
	return effectivePermissions(await repo.findGrantsForUser(userId)).includes(permission)
}

export async function listEffectivePermissions(userId: string): Promise<Permission[]> {
	return effectivePermissions(await repo.findGrantsForUser(userId))
}
