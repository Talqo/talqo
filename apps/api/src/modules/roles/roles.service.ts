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
		throw new AdminAlreadyExistsError("An admin account already exists")
	}

	const user = await identity.createAccount(input)
	try {
		await repo.insertPermissionGrant({
			id: crypto.randomUUID(),
			userId: user.id,
			permission: Permission.Admin,
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
	try {
		const row = await repo.insertPermissionGrant({
			id: crypto.randomUUID(),
			userId: input.userId,
			permission: input.permission,
			grantedBy: input.grantedBy,
		})
		return { ...row, permission: input.permission }
	} catch (error) {
		if (isForeignKeyViolation(error))
			throw new identity.UserNotFoundError(`grantPermission: user ${input.userId} not found`, { cause: error })
		if (isUniqueViolation(error)) throw new AdminAlreadyExistsError("Permission grant already exists", { cause: error })
		throw error
	}
}

export async function revokePermission(id: string): Promise<void> {
	await repo.deletePermissionGrant(id)
}

export async function getAccess(userId: string): Promise<{ permissions: Permission[] }> {
	return { permissions: await listEffectivePermissions(userId) }
}

export async function authorize(userId: string, permission: Permission): Promise<boolean> {
	return (await listEffectivePermissions(userId)).includes(permission)
}

// The only source of a user's permissions: direct grants plus every assigned role's permissions.
// Fetched fresh on every call, never cached, so a revoked grant or role denies the next request (ADR-0008/0009).
export async function listEffectivePermissions(userId: string): Promise<Permission[]> {
	const [grants, rolePermissions] = await Promise.all([
		repo.findGrantsForUser(userId),
		repo.findRolePermissionsForUser(userId),
	])
	return effectivePermissions([...grants, ...rolePermissions])
}

export const ROLE_NAME_MAX_LENGTH = 64
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
	return { name, permissions }
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
	const [found] = await toRoles([row])
	if (!found) throw new Error(`getRole: could not assemble role ${id}`)
	return found
}

export async function listRoles(): Promise<Role[]> {
	return toRoles(await repo.findRoles())
}

export async function createRole(input: RoleInput): Promise<Role> {
	const value = normalizeRoleInput(input)
	const id = crypto.randomUUID()
	try {
		await repo.insertRoleWithPermissions({ id, name: value.name }, value.permissions)
	} catch (error) {
		if (isUniqueViolation(error)) throw new DuplicateRoleNameError("A role with this name already exists")
		throw error
	}
	return getRole(id)
}

export async function updateRole(id: string, input: RoleInput): Promise<Role> {
	const value = normalizeRoleInput(input)
	try {
		if (!(await repo.updateRoleWithPermissions(id, value.name, value.permissions))) {
			throw new RoleNotFoundError(`updateRole: role ${id} not found`)
		}
	} catch (error) {
		if (isUniqueViolation(error)) throw new DuplicateRoleNameError("A role with this name already exists")
		throw error
	}
	return getRole(id)
}

export async function deleteRole(id: string): Promise<void> {
	if (!(await repo.deleteRoleById(id))) throw new RoleNotFoundError(`deleteRole: role ${id} not found`)
}

// Replaces every role of the user atomically.
export async function assignRoles(userId: string, roleIds: string[]): Promise<RoleSummary[]> {
	assertUnique(roleIds, "Role ids")
	if (roleIds.length > ROLE_IDS_MAX) throw new InvalidRoleInputError(`At most ${ROLE_IDS_MAX} roles per user`)
	await identity.getUser(userId)
	if ((await repo.findRolesByIds(roleIds)).length !== roleIds.length) {
		throw new RoleNotFoundError(`assignRoles: unknown role for user ${userId}`)
	}
	await repo.replaceUserRoles(userId, roleIds)
	return repo.findRolesOfUser(userId)
}

export type UserWithAccess = PublicUser & { permissions: Permission[]; roles: RoleSummary[] }

export async function listUsersWithAccess(): Promise<UserWithAccess[]> {
	const users = await identity.listUsers()
	return Promise.all(
		users.map(async (user) => {
			const [roles, permissions] = await Promise.all([repo.findRolesOfUser(user.id), listEffectivePermissions(user.id)])
			return { id: user.id, username: user.username, mustChangePassword: user.mustChangePassword, roles, permissions }
		}),
	)
}

export function listGrantablePermissions(): { implies: Permission[]; permission: GrantablePermission }[] {
	return GRANTABLE_PERMISSIONS.map((permission) => ({ permission, implies: IMPLIED_BY[permission] ?? [] }))
}

// Target resolvers for access.permission(P, { target }): each returns the permissions a request touches.
// A missing role or user resolves to none, so the route answers 404 instead of 403.

type PathParams = { params: Record<string, string> }

async function permissionsOfRoles(roleIds: string[]): Promise<GrantablePermission[]> {
	const rows = await repo.findPermissionsOfRoles(roleIds)
	return inCatalogOrder(
		rows.map(({ permission }) => permission),
		GRANTABLE_PERMISSIONS,
	)
}

export async function permissionsInRoleRequest(request: { body: RoleInput }): Promise<Permission[]> {
	return inCatalogOrder(request.body.permissions, PERMISSIONS)
}

export async function permissionsInRoleUpdate(request: PathParams & { body: RoleInput }): Promise<Permission[]> {
	const current = await permissionsOfRoles([request.params.roleId ?? ""])
	return inCatalogOrder([...current, ...request.body.permissions], PERMISSIONS)
}

export async function permissionsOfRole(request: PathParams): Promise<Permission[]> {
	return permissionsOfRoles([request.params.roleId ?? ""])
}

// Delta only: roles kept on both sides are neither given nor removed.
export async function permissionsInRoleAssignment(
	request: PathParams & { body: { roleIds: string[] } },
): Promise<Permission[]> {
	const current = (await repo.findRolesOfUser(request.params.userId ?? "")).map(({ id }) => id)
	const requested = new Set(request.body.roleIds)
	const changed = [
		...current.filter((id) => !requested.has(id)),
		...[...requested].filter((id) => !current.includes(id)),
	]
	return permissionsOfRoles(changed)
}

export async function permissionsOfUser(request: PathParams): Promise<Permission[]> {
	return listEffectivePermissions(request.params.userId ?? "")
}
