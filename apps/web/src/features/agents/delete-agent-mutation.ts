import { deleteAgent } from "@/api/client.ts"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { agentsQueryKey } from "./agents-query.ts"

export function useDeleteAgent() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (agentId: string) => deleteAgent(agentId),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: agentsQueryKey }),
	})
}
