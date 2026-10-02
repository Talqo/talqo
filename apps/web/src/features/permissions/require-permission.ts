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

// Declares a route's permission requirement as route context. The dashboard
// layout enforces it once, so no page renders its own denial.
export function requirePermission(permission: Permission) {
	return () => ({ requires: permission }) as const
}

// Matches arrive root-first, so the last requirement found is the deepest one.
// A nested route can therefore tighten what its parent already required.
export function useRequiredPermission(): Permission | undefined {
	let required: Permission | undefined
	for (const match of useMatches()) {
		required = (match.context as Requirement).requires ?? required
	}
	return required
}

// Unresolved permissions are never a denial: a failed or in-flight request must
// not read as "your account lacks access".
export function accessGate(required: Permission | undefined, query: PermissionQuery): AccessGate {
	if (!required) return "open"
	if (query.isPending) return "pending"
	if (query.isError) return "error"
	return query.data?.data.permissions.includes(required) ? "open" : "denied"
}
