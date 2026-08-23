import { useGetAgent } from "@/api/generated/agent/agent.ts"

export function useAgent(agentId: string) {
	return useGetAgent(agentId)
}
