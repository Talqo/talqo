import type { SaveAiProviderConfigurationInput } from "@/api/client.ts"

import {
	discoverAiProviderModels,
	getAccess,
	getAiProviderConfiguration,
	getAiProviders,
	saveAiProviderConfiguration,
} from "@/api/client.ts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

export const accessQueryKey = ["access"] as const
export const aiProvidersQueryKey = ["ai-providers"] as const
export const aiConfigurationQueryKey = ["ai-provider-configuration"] as const

export function useAccess() {
	return useQuery({ queryKey: accessQueryKey, queryFn: ({ signal }) => getAccess(signal) })
}

export function useAiProviders() {
	return useQuery({ queryKey: aiProvidersQueryKey, queryFn: ({ signal }) => getAiProviders(signal) })
}

export function useAiProviderConfiguration() {
	return useQuery({
		queryKey: aiConfigurationQueryKey,
		queryFn: ({ signal }) => getAiProviderConfiguration(signal),
	})
}

export function useDiscoverAiProviderModels() {
	return useMutation({ mutationFn: discoverAiProviderModels })
}

export function useSaveAiProviderConfiguration() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: SaveAiProviderConfigurationInput) => saveAiProviderConfiguration(input),
		onSuccess: (configuration) => queryClient.setQueryData(aiConfigurationQueryKey, configuration),
	})
}
