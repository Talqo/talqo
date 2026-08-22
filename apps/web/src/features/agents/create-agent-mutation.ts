import { createAgent, type Agent, type AgentInput } from "@/api/client.ts"
import { ApiError, CONFLICT_STATUS } from "@/api/errors.ts"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { agentsQueryKey } from "./agents-query.ts"

export const AGENT_NAME_FALLBACK_LIMIT = 20

// On name conflict the next candidate takes over so blank creation never dead-ends.
export function buildNameCandidates(baseName: string): string[] {
	return Array.from({ length: AGENT_NAME_FALLBACK_LIMIT }, (_, index) =>
		index === 0 ? baseName : `${baseName} ${index + 1}`,
	)
}

export async function createAgentWithNameFallback<TAgent extends { name: string }>(
	create: (input: AgentInput) => Promise<TAgent>,
	input: Omit<AgentInput, "name">,
	candidates: string[],
): Promise<TAgent> {
	let lastError: unknown = new ApiError(CONFLICT_STATUS, "No names available")
	for (const name of candidates) {
		try {
			// Sequential by design: each name must be rejected before the next is attempted.
			// eslint-disable-next-line no-await-in-loop
			return await create({ ...input, name })
		} catch (error) {
			if (!(error instanceof ApiError && error.status === CONFLICT_STATUS)) throw error
			lastError = error
		}
	}
	throw lastError
}

export function useCreateAgent() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ candidates, ...input }: Omit<AgentInput, "name"> & { candidates: string[] }): Promise<Agent> =>
			createAgentWithNameFallback(createAgentWrapper, input, candidates),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: agentsQueryKey }),
	})
}

const createAgentWrapper = async (input: AgentInput): Promise<Agent> => (await createAgent(input)).agent
