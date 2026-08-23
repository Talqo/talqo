import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
	createContext,
	deleteContextFile,
	listContextFiles,
	uploadContextFile,
	type ContextFilesResponse,
} from "./context-files.ts"

const key = (contextId: string) => ["context-files", contextId] as const

export type BatchFileResult = {
	name: string
	error: string | null
}

export type BatchUploadResult = {
	contextId: string
	results: BatchFileResult[]
}

export function useContextFiles(contextId: string | undefined) {
	return useQuery<ContextFilesResponse>({
		queryKey: key(contextId ?? ""),
		queryFn: () => listContextFiles(contextId as string),
		enabled: typeof contextId === "string" && contextId.length > 0,
		staleTime: Number.POSITIVE_INFINITY,
	})
}

// One batch = one context directory: the id is minted once and shared by every
// sequential upload, so concurrent batches cannot split files across dirs.
export function useUploadContextFiles() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async ({ contextId, files }: { contextId: string | undefined; files: File[] }) => {
			const id = contextId ?? (await createContext())
			const results: BatchFileResult[] = []
			// Sequential on purpose: one context id per batch (createContext happens once
			// above), and a deterministic order makes per-file feedback line up with selection order.
			for (const file of files) {
				try {
					// eslint-disable-next-line no-await-in-loop
					await uploadContextFile(id, file)
					results.push({ name: file.name, error: null })
				} catch (error) {
					results.push({ name: file.name, error: error instanceof Error ? error.message : String(error) })
				}
			}
			const result: BatchUploadResult = { contextId: id, results }
			return result
		},
		onSuccess: ({ contextId }) => queryClient.invalidateQueries({ queryKey: key(contextId) }),
	})
}

export function useDeleteContextFile() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ contextId, name }: { contextId: string; name: string }) => deleteContextFile(contextId, name),
		onSuccess: (_data, { contextId }) => queryClient.invalidateQueries({ queryKey: key(contextId) }),
	})
}
