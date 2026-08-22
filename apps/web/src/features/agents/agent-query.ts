import { getAgent } from "@/api/client.ts"
import { useQuery } from "@tanstack/react-query"

import { agentsQueryKey } from "./agents-query.ts"

export function useAgent(agentId: string) {
	return useQuery({
		queryKey: [...agentsQueryKey, agentId],
		queryFn: ({ signal }) => getAgent(agentId, signal).then(({ agent }) => agent),
		retry: false,
	})
}
