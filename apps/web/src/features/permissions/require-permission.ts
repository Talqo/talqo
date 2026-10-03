import type { GetMyPermissions200 } from "@/api/generated/models/roles/getMyPermissions200.zod"

import { useMatches } from "@tanstack/react-router"

export type Permission = GetMyPermissions200["permissions"][number]

export type AccessGate = "open" | "pending" | "error" | "denied"

type Requirement = { requires?: Permission }

type PermissionQuery = {
	data?: { data: GetMyPermissions200 }
	isPending: boolean
	isError: boolean
}

// Carries the requirement into route context, for the layout to enforce.
export function requirePermission(permission: Permission) {
	return () => ({ requires: permission }) as const
}

// Matches arrive root-first, so the last requirement found is the deepest.
export function useRequiredPermission(): Permission | undefined {
	let required: Permission | undefined
	for (const match of useMatches()) {
		required = (match.context as Requirement).requires ?? required
	}
	return required
}

// An unresolved request is never a denial.
export function accessGate(required: Permission | undefined, query: PermissionQuery): AccessGate {
	if (!required) return "open"
	if (query.isPending) return "pending"
	if (query.isError) return "error"
	return query.data?.data.permissions.includes(required) ? "open" : "denied"
}
