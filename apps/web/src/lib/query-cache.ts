import type { QueryClient } from "@tanstack/react-query"

import { getListAgentsQueryKey } from "@/api/generated/agent/agent"
import { getGetMyPermissionsQueryKey } from "@/api/generated/roles/roles"

const FORBIDDEN_STATUS = 403
const NOT_FOUND_STATUS = 404
const DENIED_STATUSES = new Set<unknown>([FORBIDDEN_STATUS, NOT_FOUND_STATUS])

type DeniedQuery = {
	queryKey: readonly unknown[]
	setState: (state: { data: undefined }) => void
}

// A revoked or removed resource must not keep rendering cached private data.
export function handleDeniedQueryError(client: QueryClient, error: Error, query: DeniedQuery): void {
	if (!("status" in error) || !DENIED_STATUSES.has(error.status)) return
	query.setState({ data: undefined })
	for (const queryKey of [getListAgentsQueryKey(), getGetMyPermissionsQueryKey()]) {
		if (query.queryKey[0] !== queryKey[0]) void client.invalidateQueries({ queryKey })
	}
}
