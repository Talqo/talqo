import { getMyPermissions } from "@/api/client.ts"
import { useQuery } from "@tanstack/react-query"

export const myPermissionsQueryKey = ["me", "permissions"] as const

export function useMyPermissions() {
	return useQuery({
		queryKey: myPermissionsQueryKey,
		queryFn: ({ signal }) => getMyPermissions(signal).then(({ permissions }) => permissions),
		retry: false,
	})
}
