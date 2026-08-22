import { listAgents } from "@/api/client.ts"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"

export const agentsQueryKey = ["agents"] as const

export function useAgents() {
	return useQuery({
		queryKey: agentsQueryKey,
		queryFn: ({ signal }) => listAgents(signal).then(({ agents }) => agents),
		retry: false,
	})
}

export function useActiveAgent() {
	const { data: agentList, error, isLoading } = useAgents()
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
