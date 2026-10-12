import type { Role } from "@/api/generated/models/role.zod"
import type { ListGrantablePermissions200 } from "@/api/generated/models/roles/listGrantablePermissions200.zod"

import { CreateRoleBody, createRoleBodyNameMax } from "@/api/generated/models/roles/createRoleBody.zod"
import { z } from "zod"

import type { GrantablePermission } from "./permission-labels"

export type PermissionCatalog = ListGrantablePermissions200["permissions"]

// Trimmed like the API, so a blank name fails here instead of on save.
export const roleFormSchema = CreateRoleBody.safeExtend({ name: z.string().trim().min(1).max(createRoleBodyNameMax) })

export type RoleFormValues = z.infer<typeof roleFormSchema>

// Each permission included by another selected one, mapped to the first selected permission that includes it.
export function includedPermissions(
	selected: readonly GrantablePermission[],
	catalog: PermissionCatalog,
): Map<GrantablePermission, GrantablePermission> {
	const included = new Map<GrantablePermission, GrantablePermission>()
	for (const { permission, implies } of catalog) {
		if (!selected.includes(permission)) continue
		for (const implied of implies) {
			const grantable = catalog.find((entry) => entry.permission === implied)?.permission
			if (grantable && !included.has(grantable)) included.set(grantable, permission)
		}
	}
	return included
}

// Catalog order, without permissions another selected one already includes.
export function explicitPermissions(
	selected: readonly GrantablePermission[],
	catalog: PermissionCatalog,
): GrantablePermission[] {
	const included = includedPermissions(selected, catalog)
	return catalog
		.map(({ permission }) => permission)
		.filter((permission) => selected.includes(permission) && !included.has(permission))
}

type PermissionHolder = Pick<Role, "permissions">

// The API refuses changes involving access the operator lacks, so the UI only offers what they hold.
export function holdsAll(heldPermissions: readonly string[], permissions: readonly string[]): boolean {
	return permissions.every((permission) => heldPermissions.includes(permission))
}

function managesRoles(roles: readonly PermissionHolder[]): boolean {
	return roles.some(({ permissions }) => permissions.includes("roles:manage"))
}

// True when the operator's roles give role management before a change and not after it.
// A direct grant is invisible here, so the warning can appear when it is not needed; it never blocks.
export function losesRoleManagement(input: {
	heldPermissions: readonly string[]
	rolesAfter: readonly PermissionHolder[]
	rolesBefore: readonly PermissionHolder[]
}): boolean {
	if (input.heldPermissions.includes("admin")) return false
	return managesRoles(input.rolesBefore) && !managesRoles(input.rolesAfter)
}
