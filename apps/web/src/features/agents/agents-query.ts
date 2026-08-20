import type { Agent } from "@/api/client.ts"

import { getAgent, listAgents } from "@/api/client.ts"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"

export type { Agent }

export const agentQueryKeys = {
	all: ["agents"] as const,
	list: () => [...agentQueryKeys.all, "list"] as const,
	detail: (id: string) => [...agentQueryKeys.all, "detail", id] as const,
}

export function useAgents() {
	return useQuery({
		queryKey: agentQueryKeys.list(),
		queryFn: async ({ signal }) => (await listAgents(signal)).agents,
	})
}

export function useAgent(id: string) {
	const queryClient = useQueryClient()
	return useQuery({
		queryKey: agentQueryKeys.detail(id),
		queryFn: async ({ signal }) => (await getAgent(id, signal)).agent,
		// Paint from the list the user just came from, then refetch in the background.
		initialData: () => queryClient.getQueryData<Agent[]>(agentQueryKeys.list())?.find((agent) => agent.id === id),
		initialDataUpdatedAt: () => queryClient.getQueryState(agentQueryKeys.list())?.dataUpdatedAt,
	})
}

/** Keeps the chosen agent in the URL so an operator can share or reload the view. */
export function useActiveAgent() {
	const { data: agentList, isLoading } = useAgents()
	const { agent: selectedId } = useSearch({ strict: false })
	const navigate = useNavigate()
	const activeId =
		typeof selectedId === "string" && agentList?.some((agent) => agent.id === selectedId)
			? selectedId
			: (agentList?.[0]?.id ?? "")
	const setSelectedId = (id: string) =>
		navigate({
			to: ".",
			search: (previous: Record<string, unknown>) => ({ ...previous, agent: id || undefined }),
			replace: true,
		})
	return { agents: agentList, isLoading, activeId, setSelectedId }
}
