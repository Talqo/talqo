import type { CreateAgentBody } from "@/api/generated/models/agent/createAgentBody.zod.ts"

import { createAgent, getListAgentsQueryKey, type CreateAgentMutationError } from "@/api/generated/agent/agent.ts"
import { useMutation, useQueryClient } from "@tanstack/react-query"

const CONFLICT_STATUS = 409

export const AGENT_NAME_FALLBACK_LIMIT = 20

// On name conflict the next candidate takes over so blank creation never dead-ends.
export function buildNameCandidates(baseName: string): string[] {
	return Array.from({ length: AGENT_NAME_FALLBACK_LIMIT }, (_, index) =>
		index === 0 ? baseName : `${baseName} ${index + 1}`,
	)
}

export async function createAgentWithNameFallback<TAgent extends { name: string }>(
	create: (input: CreateAgentBody) => Promise<TAgent>,
	input: Omit<CreateAgentBody, "name">,
	candidates: string[],
): Promise<TAgent> {
	let lastError: unknown = new Error("No names available")
	for (const name of candidates) {
		try {
			// Sequential by design: each name must be rejected before the next is attempted.
			// eslint-disable-next-line no-await-in-loop
			return await create({ ...input, name })
		} catch (error) {
			if ((error as CreateAgentMutationError).status !== CONFLICT_STATUS) throw error
			lastError = error
		}
	}
	throw lastError
}

export function useCreateAgent() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ candidates, ...input }: Omit<CreateAgentBody, "name"> & { candidates: string[] }) =>
			createAgentWithNameFallback(async (body) => (await createAgent(body)).data.agent, input, candidates),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() }),
	})
}
