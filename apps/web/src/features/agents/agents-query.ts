import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"

export type Agent = {
	id: string
	name: string
	status: "active" | "paused"
	systemPrompt: string
	wordBlacklist: string[]
}

const agentsQueryKey = ["agents"] as const

const DEMO_AGENTS: Agent[] = [
	{
		id: "demo-1",
		name: "Demo agent 1",
		status: "active",
		systemPrompt: "Demo system prompt.",
		wordBlacklist: ["spam", "abuse"],
	},
	{
		id: "demo-2",
		name: "Demo agent 2",
		status: "paused",
		systemPrompt: "Demo system prompt.",
		wordBlacklist: [],
	},
]

let agents: Agent[] = import.meta.env.VITE_MOCK_AGENTS === "true" ? [...DEMO_AGENTS] : []

export function useAgents() {
	return useQuery({
		queryKey: agentsQueryKey,
		queryFn: () => Promise.resolve(agents),
		staleTime: Number.POSITIVE_INFINITY,
	})
}

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

export function useAgent(id: string) {
	return useQuery({
		queryKey: [...agentsQueryKey, id],
		queryFn: () => Promise.resolve(agents.find((agent) => agent.id === id) ?? null),
	})
}

function useInvalidateAgents() {
	const queryClient = useQueryClient()
	return () => queryClient.invalidateQueries({ queryKey: agentsQueryKey })
}

export function useUpdateAgent() {
	const invalidate = useInvalidateAgents()
	return (id: string, patch: Partial<Omit<Agent, "id">>) => {
		agents = agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent))
		invalidate()
	}
}

export function useCreateAgent() {
	const invalidate = useInvalidateAgents()
	return (input: Omit<Agent, "id">) => {
		const agent: Agent = { id: `local-${Date.now()}`, ...input }
		agents = [...agents, agent]
		invalidate()
		return agent
	}
}
