import type { QueryClient } from "@tanstack/react-query"

import { getListAgentsQueryKey } from "@/api/generated/agent/agent"
import { getGetMyPermissionsQueryKey } from "@/api/generated/roles/roles"

const FORBIDDEN_STATUS = 403
const NOT_FOUND_STATUS = 404

type DeniedQuery = {
	queryKey: readonly unknown[]
	setState: (state: { data: undefined }) => void
}

// A revoked or removed resource must not keep rendering cached private data.
export function handleDeniedQueryError(client: QueryClient, error: Error, query: DeniedQuery): void {
	if (!("status" in error) || (error.status !== FORBIDDEN_STATUS && error.status !== NOT_FOUND_STATUS)) return
	query.setState({ data: undefined })
	if (query.queryKey[0] !== getListAgentsQueryKey()[0])
		void client.invalidateQueries({ queryKey: getListAgentsQueryKey() })
	if (query.queryKey[0] !== getGetMyPermissionsQueryKey()[0])
		void client.invalidateQueries({ queryKey: getGetMyPermissionsQueryKey() })
}
