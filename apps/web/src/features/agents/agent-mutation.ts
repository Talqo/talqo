import type { Agent, AgentInput } from "@/api/client.ts"

import { createAgent, deleteAgent, updateAgent } from "@/api/client.ts"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { agentQueryKeys } from "./agents-query.ts"

export function useCreateAgent() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async (input: AgentInput & { name: string }) => (await createAgent(input)).agent,
		onSuccess: (agent: Agent) => {
			queryClient.setQueryData(agentQueryKeys.detail(agent.id), agent)
			return queryClient.invalidateQueries({ queryKey: agentQueryKeys.list() })
		},
	})
}

/** Takes the id per call so the agent list can toggle any row without a hook per row. */
export function useUpdateAgent() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async ({ id, ...input }: AgentInput & { id: string }) => (await updateAgent(id, input)).agent,
		onSuccess: (agent: Agent) => {
			queryClient.setQueryData(agentQueryKeys.detail(agent.id), agent)
			return queryClient.invalidateQueries({ queryKey: agentQueryKeys.list() })
		},
	})
}

export function useDeleteAgent() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: string) => deleteAgent(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: agentQueryKeys.all }),
	})
}
