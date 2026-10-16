import type { PublicUser } from "@/modules/identity/identity.service.ts"

import { ApiError, PROBLEM_CODES } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { generateOpaqueToken, hashOpaqueToken } from "@/lib/opaque-token.ts"
import { isForeignKeyViolation, isUniqueViolation } from "@/lib/pg-error.ts"
import * as identity from "@/modules/identity/identity.service.ts"

import * as repo from "./roles.repository.ts"

// eslint-disable-next-line no-magic-numbers
const INVITATION_DURATION_MS = 1000 * 60 * 60 * 24 * 7

// Everything a role may hold; `admin` is held only through the admin grant.
export const GRANTABLE_PERMISSIONS = [
	"users:read",
	"users:manage",
	"roles:manage",
	"ai_provider:manage",
	"agents:read",
	"agents:manage",
] as const
export const PERMISSIONS = ["admin", ...GRANTABLE_PERMISSIONS] as const
export type Permission = (typeof PERMISSIONS)[number]
export type GrantablePermission = (typeof GRANTABLE_PERMISSIONS)[number]

// Named constants for call sites, so authorization checks never depend on hand-typed strings.
export const Permission = {
	Admin: "admin",
	UsersRead: "users:read",
	UsersManage: "users:manage",
	RolesManage: "roles:manage",
	AiProviderManage: "ai_provider:manage",
	AgentsRead: "agents:read",
	AgentsManage: "agents:manage",
} as const satisfies Record<string, Permission>

// "admin" is the first entry only for display stability; it implies every other permission.
const IMPLIED_BY: Partial<Record<Permission, Permission[]>> = {
	admin: PERMISSIONS.filter((permission) => permission !== "admin"),
	// Mutating grants imply read access to the same capability; keep this a DAG, never a cycle.
	"agents:manage": ["agents:read"],
	"users:manage": ["users:read"],
	"roles:manage": ["users:read"],
}

function expandPermissions(granted: Permission[]): Permission[] {
	const effective = new Set<Permission>(granted)
	for (const permission of granted) {
		for (const implied of IMPLIED_BY[permission] ?? []) effective.add(implied)
	}
	return PERMISSIONS.filter((permission) => effective.has(permission))
}

// One permission from the admin grant or from an assigned role.
type PermissionSource = { permission: string }

export function effectivePermissions(sources: PermissionSource[]): Permission[] {
	const granted = new Set(sources.map(({ permission }) => permission))
	return expandPermissions(PERMISSIONS.filter((permission) => granted.has(permission)))
}

class AdminAlreadyExistsError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.ADMIN_ALREADY_EXISTS, HTTP_STATUS.CONFLICT, message, undefined, options)
	}
}
class InvalidInvitationError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.INVALID_INVITATION, HTTP_STATUS.CONFLICT, message, undefined, options)
	}
}

export async function hasAdmin(): Promise<boolean> {
	return repo.adminGrantExists()
}

export async function bootstrapAdmin(input: { password: string; username: string }): Promise<PublicUser> {
	if (await repo.adminGrantExists()) {
		throw new AdminAlreadyExistsError("An admin user already exists")
	}

	const user = await identity.createUser(input)
	try {
		await repo.insertPermissionGrant({
			id: crypto.randomUUID(),
			userId: user.id,
			permission: Permission.Admin,
			grantedBy: user.id,
		})
	} catch (error) {
		// A lost bootstrap race must not leave a user with no access occupying the username.
		await identity.deleteUser(user.id)
		if (isUniqueViolation(error)) throw new AdminAlreadyExistsError("An admin user already exists")
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
		return await identity.createUser({ username: input.username, password: input.password })
	} catch (error) {
		// A recoverable failure (e.g. username taken) shouldn't burn a single-use invite --
		// give the same link back its claim so the invitee can retry with a different username.
		await repo.unclaimInvitation(claimed.id)
		throw error
	}
}

// The only source of a user's permissions: the admin grant plus every assigned role's permissions.
// Fetched fresh on every call, never cached, so a removed role denies the next request (ADR-0008/0009).
export async function listEffectivePermissions(userId: string): Promise<Permission[]> {
	return effectivePermissions(await repo.findPermissionsForUsers([userId]))
}

export const ROLE_NAME_MAX_LENGTH = 64
// Bounds a replacement request's database work; deployments may create more roles.
export const ROLE_IDS_MAX = 100

export class InvalidRoleInputError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.INVALID_REQUEST, HTTP_STATUS.BAD_REQUEST, message, undefined, options)
	}
}
export class RoleNotFoundError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.ROLE_NOT_FOUND, HTTP_STATUS.NOT_FOUND, message, undefined, options)
	}
}
export class DuplicateRoleNameError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.ROLE_NAME_TAKEN, HTTP_STATUS.CONFLICT, message, undefined, options)
	}
}
class PermissionDeniedError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN, message, undefined, options)
	}
}
class PermissionExceedsOwnError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.PERMISSION_EXCEEDS_OWN, HTTP_STATUS.FORBIDDEN, message, undefined, options)
	}
}
class PasswordChangeRequiredError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED, HTTP_STATUS.FORBIDDEN, message, undefined, options)
	}
}

async function managementPermissions(actorId: string, permission: Permission): Promise<Permission[]> {
	const held = await listEffectivePermissions(actorId)
	if (!held.includes(permission)) throw new PermissionDeniedError(`Missing ${permission}`)
	if ((await identity.getUser(actorId)).mustChangePassword) {
		throw new PasswordChangeRequiredError("Password change required")
	}
	return held
}

function requireHeld(held: readonly Permission[], targeted: readonly Permission[]): void {
	if (targeted.some((permission) => !held.includes(permission))) {
		throw new PermissionExceedsOwnError("Cannot manage access beyond own permissions")
	}
}

export type Role = { id: string; memberCount: number; name: string; permissions: GrantablePermission[] }
export type RoleInput = { name: string; permissions: Permission[] }
export type RoleSummary = { id: string; name: string }

function isGrantable(permission: string): permission is GrantablePermission {
	return (GRANTABLE_PERMISSIONS as readonly string[]).includes(permission)
}

// Catalog order, so responses and comparisons never depend on insertion order.
function inCatalogOrder<P extends Permission>(permissions: Iterable<string>, catalog: readonly P[]): P[] {
	const wanted = new Set(permissions)
	return catalog.filter((permission) => wanted.has(permission))
}

function assertUnique(values: string[], label: string): void {
	if (new Set(values).size !== values.length) throw new InvalidRoleInputError(`${label} must not repeat`)
}

function normalizeRoleInput(input: RoleInput): { name: string; permissions: GrantablePermission[] } {
	const name = input.name.trim()
	if (name.length === 0) throw new InvalidRoleInputError("Role name is required")
	if (name.length > ROLE_NAME_MAX_LENGTH) {
		throw new InvalidRoleInputError(`Role name must be at most ${ROLE_NAME_MAX_LENGTH} characters`)
	}
	assertUnique(input.permissions, "Role permissions")
	const permissions = input.permissions.filter(isGrantable)
	if (permissions.length !== input.permissions.length) {
		throw new InvalidRoleInputError("Roles may hold only grantable permissions")
	}
	return {
		name,
		permissions: permissions.filter(
			(permission) => !permissions.some((other) => IMPLIED_BY[other]?.includes(permission)),
		),
	}
}

async function toRoles(rows: repo.Role[]): Promise<Role[]> {
	const ids = rows.map((row) => row.id)
	const [permissionRows, counts] = await Promise.all([repo.findPermissionsOfRoles(ids), repo.countMembersByRole(ids)])
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		permissions: inCatalogOrder(
			permissionRows.filter(({ roleId }) => roleId === row.id).map(({ permission }) => permission),
			GRANTABLE_PERMISSIONS,
		),
		memberCount: counts.find(({ roleId }) => roleId === row.id)?.memberCount ?? 0,
	}))
}

async function getRole(id: string): Promise<Role> {
	const row = await repo.findRoleById(id)
	if (!row) throw new RoleNotFoundError(`getRole: role ${id} not found`)
	const [permissions, counts] = await Promise.all([permissionsOfRoles([id]), repo.countMembersByRole([id])])
	return { id: row.id, name: row.name, permissions, memberCount: counts[0]?.memberCount ?? 0 }
}

export async function listRoles(): Promise<Role[]> {
	return toRoles(await repo.findRoles())
}

export async function createRole(input: RoleInput, actorId: string): Promise<Role> {
	const value = normalizeRoleInput(input)
	return repo.withAccessLock(async () => {
		const held = await managementPermissions(actorId, Permission.RolesManage)
		requireHeld(held, value.permissions)
		const id = crypto.randomUUID()
		try {
			await repo.insertRoleWithPermissions({ id, name: value.name }, value.permissions)
		} catch (error) {
			if (isUniqueViolation(error)) throw new DuplicateRoleNameError("A role with this name already exists")
			throw error
		}
		return getRole(id)
	})
}

export async function updateRole(id: string, input: RoleInput, actorId: string): Promise<Role> {
	const value = normalizeRoleInput(input)
	return repo.withAccessLock(async () => {
		const held = await managementPermissions(actorId, Permission.RolesManage)
		const current = await getRole(id)
		requireHeld(held, [...current.permissions, ...value.permissions])
		try {
			await repo.updateRoleWithPermissions(id, value.name, value.permissions)
		} catch (error) {
			if (isUniqueViolation(error)) throw new DuplicateRoleNameError("A role with this name already exists")
			throw error
		}
		return getRole(id)
	})
}

export async function deleteRole(id: string, actorId: string): Promise<void> {
	await repo.withAccessLock(async () => {
		const held = await managementPermissions(actorId, Permission.RolesManage)
		const current = await getRole(id)
		requireHeld(held, current.permissions)
		await repo.deleteRoleById(id)
	})
}

export async function assignRoles(userId: string, roleIds: string[], actorId: string): Promise<RoleSummary[]> {
	assertUnique(roleIds, "Role ids")
	if (roleIds.length > ROLE_IDS_MAX) throw new InvalidRoleInputError(`At most ${ROLE_IDS_MAX} roles per user`)
	return repo.withAccessLock(async () => {
		const held = await managementPermissions(actorId, Permission.RolesManage)
		await identity.getUser(userId)
		if ((await repo.findRolesByIds(roleIds)).length !== roleIds.length) {
			throw new RoleNotFoundError(`assignRoles: unknown role for user ${userId}`)
		}
		const current = (await repo.findRolesOfUser(userId)).map(({ id }) => id)
		const changed = [...current.filter((id) => !roleIds.includes(id)), ...roleIds.filter((id) => !current.includes(id))]
		requireHeld(held, await permissionsOfRoles(changed))
		try {
			await repo.replaceUserRoles(userId, roleIds)
		} catch (error) {
			if (!isForeignKeyViolation(error)) throw error
			await identity.getUser(userId)
			throw new RoleNotFoundError(`assignRoles: a role was deleted while assigning user ${userId}`)
		}
		return repo.findRolesOfUser(userId)
	})
}

export type UserWithAccess = Omit<PublicUser, "mustChangePassword"> & {
	permissions: Permission[]
	canManage: boolean
	mustChangePassword: boolean | null
	roles: RoleSummary[]
}

export async function listUsersWithAccess(actorId: string): Promise<UserWithAccess[]> {
	const users = await identity.listUsers()
	const userIds = users.map(({ id }) => id)
	const [roles, sources] = await Promise.all([
		repo.findRolesOfUsers(userIds),
		repo.findPermissionsForUsers([...new Set([...userIds, actorId])]),
	])
	const rolesByUser = Map.groupBy(roles, ({ userId }) => userId)
	const sourcesByUser = Map.groupBy(sources, ({ userId }) => userId)
	const held = effectivePermissions(sourcesByUser.get(actorId) ?? [])
	const managesUsers = held.includes(Permission.UsersManage)
	return users.map((user) => {
		const permissions = effectivePermissions(sourcesByUser.get(user.id) ?? [])
		return {
			id: user.id,
			username: user.username,
			permissions,
			canManage: managesUsers && permissions.every((permission) => held.includes(permission)),
			mustChangePassword: managesUsers ? user.mustChangePassword : null,
			roles: (rolesByUser.get(user.id) ?? []).map(({ id, name }) => ({ id, name })),
		}
	})
}

export function listGrantablePermissions(): { implies: GrantablePermission[]; permission: GrantablePermission }[] {
	return GRANTABLE_PERMISSIONS.map((permission) => ({
		permission,
		implies: (IMPLIED_BY[permission] ?? []).filter(isGrantable),
	}))
}

async function permissionsOfRoles(roleIds: string[]): Promise<GrantablePermission[]> {
	const rows = await repo.findPermissionsOfRoles(roleIds)
	return inCatalogOrder(
		rows.map(({ permission }) => permission),
		GRANTABLE_PERMISSIONS,
	)
}

export async function resetUserPassword(userId: string, newPassword: string, actorId: string): Promise<void> {
	await repo.withAccessLock(async () => {
		const held = await managementPermissions(actorId, Permission.UsersManage)
		await identity.getUser(userId)
		requireHeld(held, await listEffectivePermissions(userId))
		await identity.setPassword(userId, newPassword)
	})
}

export async function deleteUser(userId: string, actorId: string): Promise<void> {
	await repo.withAccessLock(async () => {
		const held = await managementPermissions(actorId, Permission.UsersManage)
		await identity.getUser(userId)
		requireHeld(held, await listEffectivePermissions(userId))
		await identity.deleteUser(userId)
	})
}
