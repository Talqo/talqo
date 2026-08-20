import { getGetSessionQueryKey } from "@/api/generated/identity/identity.ts"
import { QueryClient } from "@tanstack/react-query"
import { expect, it } from "bun:test"

import { clearSessionCache } from "./session-cache.ts"

it("removes cached anonymous session data", () => {
	const queryClient = new QueryClient()
	queryClient.setQueryData(getGetSessionQueryKey(), { data: { user: null } })

	clearSessionCache(queryClient)

	expect(queryClient.getQueryData(getGetSessionQueryKey())).toBeUndefined()
})
