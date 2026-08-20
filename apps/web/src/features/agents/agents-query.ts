import * as api from "@/api/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"

export type Agent = api.Agent
export type AgentFile = api.AgentFile

const agentsQueryKey = ["agents"] as const

export function useAgents() {
	return useQuery({
		queryKey: agentsQueryKey,
		queryFn: ({ signal }) => api.getAgents(signal).then(({ agents }) => agents),
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
		queryFn: ({ signal }) => api.getAgent(id, signal).then(({ agent }) => agent),
		retry: false,
	})
}

export function useAgentFiles(agentId: string) {
	return useQuery({
		queryKey: [...agentsQueryKey, agentId, "files"],
		queryFn: ({ signal }) => api.getAgentFiles(agentId, signal),
	})
}

function useInvalidateAgents() {
	const queryClient = useQueryClient()
	return () => void queryClient.invalidateQueries({ queryKey: agentsQueryKey })
}

// The create endpoint accepts only a name; the rest of the form is applied as a follow-up patch.
export function useCreateAgent() {
	const invalidate = useInvalidateAgents()
	return useMutation({
		mutationFn: (input: Omit<Agent, "id">) =>
			api.createAgent({ name: input.name }).then(({ agent }) =>
				api
					.updateAgent(agent.id, {
						systemPrompt: input.systemPrompt,
						wordBlacklist: input.wordBlacklist,
						active: input.status === "active",
					})
					.then(({ agent: updated }) => updated),
			),
		onSuccess: invalidate,
	})
}

export function useUpdateAgent() {
	const invalidate = useInvalidateAgents()
	return useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: Partial<Omit<Agent, "id">> }) => {
			const { status, ...rest } = patch
			return api
				.updateAgent(id, { ...rest, ...(status ? { active: status === "active" } : {}) })
				.then(({ agent }) => agent)
		},
		onSuccess: invalidate,
	})
}

export function useUploadAgentFile() {
	const invalidate = useInvalidateAgents()
	return useMutation({
		mutationFn: ({ agentId, file }: { agentId: string; file: File }) => api.uploadAgentFile(agentId, file),
		onSuccess: invalidate,
	})
}

export function useRenameAgentFile() {
	const invalidate = useInvalidateAgents()
	return useMutation({
		mutationFn: ({ agentId, name, newName }: { agentId: string; name: string; newName: string }) =>
			api.renameAgentFile(agentId, name, newName),
		onSuccess: invalidate,
	})
}

export function useDeleteAgentFile() {
	const invalidate = useInvalidateAgents()
	return useMutation({
		mutationFn: ({ agentId, name }: { agentId: string; name: string }) => api.deleteAgentFile(agentId, name),
		onSuccess: invalidate,
	})
}
