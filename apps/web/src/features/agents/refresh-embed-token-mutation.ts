import { refreshAgentEmbedToken, type Agent } from "@/api/client.ts"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { agentsQueryKey } from "./agents-query.ts"

export function useRefreshEmbedToken() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ agentId }: { agentId: string }): Promise<Agent> =>
			refreshAgentEmbedToken(agentId).then(({ agent }) => agent),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: agentsQueryKey }),
	})
}
