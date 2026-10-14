import { getGetMyPermissionsQueryKey, getListRolesQueryKey, getListUsersQueryKey } from "@/api/generated/roles/roles"
import { useQueryClient } from "@tanstack/react-query"

export function useRefreshAccess() {
	const queryClient = useQueryClient()
	return () =>
		Promise.all(
			[getListRolesQueryKey(), getListUsersQueryKey(), getGetMyPermissionsQueryKey()].map((queryKey) =>
				queryClient.invalidateQueries({ queryKey }),
			),
		)
}
