import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useNavigate, useSearch } from "@tanstack/react-router"

export function useActiveAgent() {
	const { data, error, isLoading } = useListAgents()
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
