import type { ListAgents200 } from "@/api/generated/models/agent/listAgents200.zod"
import type { GetMyPermissions200 } from "@/api/generated/models/roles/getMyPermissions200.zod"

import { useMatches } from "@tanstack/react-router"

export type Permission =
	GetMyPermissions200["permissions"][number] | ListAgents200["agents"][number]["permissions"][number]

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

type AgentsQuery = { isPending: boolean; isError: boolean; data?: { data: ListAgents200 } }

function isAgentScoped(required: Permission): boolean {
	return required.startsWith("agents:") || required === "stats:read" || required === "conversations:read"
}

function agentAccessGate(required: Permission, agents: AgentsQuery | undefined): AccessGate {
	if (!agents || agents.isPending) return "pending"
	if (agents.isError) return "error"
	return agents.data?.data.agents.some((agent) => (agent.permissions as readonly string[]).includes(required))
		? "open"
		: "denied"
}

function permissionState(query: PermissionQuery): "pending" | "error" | undefined {
	if (query.isPending) return "pending"
	if (query.isError) return "error"
	return undefined
}

function hasPermission(query: PermissionQuery, required: Permission): boolean {
	const permissions: readonly string[] = query.data?.data.permissions ?? []
	return permissions.includes("admin") || permissions.includes(required)
}

// An unresolved request is never a denial.
export function accessGate(required: Permission | undefined, query: PermissionQuery, agents?: AgentsQuery): AccessGate {
	if (!required) return "open"
	const state = permissionState(query)
	if (state) return state
	if (hasPermission(query, required)) return "open"
	return isAgentScoped(required) ? agentAccessGate(required, agents) : "denied"
}
