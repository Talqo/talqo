import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"

export type Agent = {
	id: string
	name: string
	status: "active" | "paused"
	systemPrompt: string
	wordBlacklist: string[]
	// Real context id once the first knowledge file has been uploaded; undefined until then.
	contextId?: string
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

// TODO(agents-api): replace the in-memory seed with GET /agents when the endpoint lands.
function seedAgents(): Agent[] {
	return import.meta.env.VITE_MOCK_AGENTS === "true" ? structuredClone(DEMO_AGENTS) : []
}

export function useAgents() {
	return useQuery({
		queryKey: agentsQueryKey,
		queryFn: () => Promise.resolve([] as Agent[]),
		initialData: seedAgents,
		initialDataUpdatedAt: 0,
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
	const queryClient = useQueryClient()
	return useQuery({
		queryKey: [...agentsQueryKey, id],
		queryFn: () => Promise.resolve(null as Agent | null),
		initialData: () => {
			const agents = queryClient.getQueryData<Agent[]>(agentsQueryKey)
			return agents?.find((agent) => agent.id === id) ?? seedAgents().find((agent) => agent.id === id) ?? null
		},
		initialDataUpdatedAt: () => queryClient.getQueryState(agentsQueryKey)?.dataUpdatedAt,
		staleTime: Number.POSITIVE_INFINITY,
	})
}

export function useCreateAgent() {
	const queryClient = useQueryClient()
	return (input: Omit<Agent, "id">) => {
		const agent: Agent = { id: `local-${Date.now()}`, ...input }
		queryClient.setQueryData<Agent[]>(agentsQueryKey, (current) => [...(current ?? []), agent])
		return agent
	}
}

export function useUpdateAgent() {
	const queryClient = useQueryClient()
	return (id: string, patch: Partial<Omit<Agent, "id">>) => {
		queryClient.setQueryData<Agent[]>(agentsQueryKey, (current) =>
			(current ?? []).map((agent) => (agent.id === id ? Object.assign({}, agent, patch) : agent)),
		)
	}
}
