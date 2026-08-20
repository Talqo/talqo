import type { QueryClient } from "@tanstack/react-query"

import { getGetSessionQueryKey } from "@/api/generated/identity/identity.ts"

export function clearSessionCache(queryClient: QueryClient): void {
	queryClient.removeQueries({ queryKey: getGetSessionQueryKey() })
}
