import { getGetMyPermissionsQueryKey } from "@/api/generated/roles/roles.ts"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

const UNAUTHORIZED_STATUS = 401
const FORBIDDEN_STATUS = 403

export function useAccessError(...errors: unknown[]): boolean {
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const statuses = new Set(
		errors.map((error) =>
			typeof error === "object" && error !== null && "status" in error ? error.status : undefined,
		),
	)
	const unauthorized = statuses.has(UNAUTHORIZED_STATUS)
	const forbidden = statuses.has(FORBIDDEN_STATUS)
	useEffect(() => {
		if (unauthorized) void navigate({ to: "/login" })
		else if (forbidden) void queryClient.invalidateQueries({ queryKey: getGetMyPermissionsQueryKey() })
	}, [unauthorized, forbidden, navigate, queryClient])
	return forbidden
}
