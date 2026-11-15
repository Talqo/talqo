import { getListAgentsQueryKey, useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { clearAgentContent } from "@/features/permissions/clear-agent-content"
import { accessGate, useRequiredPermission } from "@/features/permissions/require-permission"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { useEffect } from "react"

import { allowedNavItems } from "./-dashboard-nav"

function deniedDestination(permissions: string[], agents: { permissions: string[] }[]) {
	return allowedNavItems(permissions, agents)[0]?.to ?? "/dashboard/account"
}

export function useDashboardGate() {
	const permissions = useGetMyPermissions()
	const agents = useListAgents()
	const gate = accessGate(useRequiredPermission(), permissions, agents)
	const navigate = useNavigate()
	const queryClient = useQueryClient()

	useEffect(() => {
		if (gate !== "denied" || !permissions.data || !agents.data) return
		clearAgentContent(queryClient)
		void navigate({
			to: deniedDestination(permissions.data.data.permissions, agents.data.data.agents),
			replace: true,
		})
	}, [gate, permissions.data, agents.data, navigate, queryClient])

	return {
		gate,
		error: permissions.error ?? agents.error,
		retry: () => {
			void permissions.refetch()
			void agents.refetch()
		},
	}
}

export function useAgentDiscoveryRefresh() {
	const router = useRouter()
	const queryClient = useQueryClient()

	useEffect(
		() =>
			router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
				if (fromLocation?.pathname === toLocation.pathname) return
				void queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() })
			}),
		[router, queryClient],
	)
}
