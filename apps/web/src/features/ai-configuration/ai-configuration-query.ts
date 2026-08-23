import {
	getGetAiProviderConfigurationQueryKey,
	useGetAiProviderConfiguration,
	useListAiProviders,
	useSaveAiProviderConfiguration as useSaveMutation,
} from "@/api/generated/ai-providers/ai-providers.ts"
import { useQueryClient } from "@tanstack/react-query"

export { useDiscoverAiProviderModels } from "@/api/generated/ai-providers/ai-providers.ts"
export { useGetAccess as useAccess } from "@/api/generated/roles/roles.ts"

export function useAiProviders() {
	return useListAiProviders()
}

export function useAiProviderConfiguration() {
	return useGetAiProviderConfiguration()
}

export function useSaveAiProviderConfiguration() {
	const queryClient = useQueryClient()
	return useSaveMutation({
		mutation: {
			onSuccess: (result) => queryClient.setQueryData(getGetAiProviderConfigurationQueryKey(), result),
		},
	})
}
