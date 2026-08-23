import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"

export function useMyPermissions() {
	const query = useGetMyPermissions()
	return { ...query, data: query.data?.data.permissions }
}
