import { updateAgent, type Agent, type AgentInput } from "@/api/client.ts"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { agentsQueryKey } from "./agents-query.ts"

export function useUpdateAgent() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ agentId, input }: { agentId: string; input: AgentInput }): Promise<Agent> =>
			updateAgent(agentId, input).then(({ agent }) => agent),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: agentsQueryKey }),
	})
}
