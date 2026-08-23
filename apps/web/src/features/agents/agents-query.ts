import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useNavigate, useSearch } from "@tanstack/react-router"

// Prefix key covering every agents query (list and single agent) for invalidation.
export const agentsQueryKey = ["/api/agents"] as const

export function useAgents() {
	return useListAgents()
}

export function useActiveAgent() {
	const { data, error, isLoading } = useAgents()
	const agentList = data?.data.agents
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
	return { agents: agentList, error, isLoading, activeId, setSelectedId }
}
