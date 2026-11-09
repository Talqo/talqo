import { QueryClient } from "@tanstack/react-query"
import { describe, expect, spyOn, test } from "bun:test"

import { handleDeniedQueryError } from "./query-cache"

function deniedError(status: number) {
	return Object.assign(new Error("Request failed"), { status })
}

function query(client: QueryClient, queryKey: readonly unknown[]) {
	const found = client.getQueryCache().find({ queryKey })
	if (!found) throw new Error("Query not cached")
	return found
}

describe("handleDeniedQueryError", () => {
	test("ignores failures that are not a denied or missing resource", () => {
		const client = new QueryClient()
		const invalidate = spyOn(client, "invalidateQueries")
		client.setQueryData(["/api/stats"], { private: true })
		const cached = query(client, ["/api/stats"])

		handleDeniedQueryError(client, new Error("Network failed"), cached)
		handleDeniedQueryError(client, deniedError(500), cached)

		expect(client.getQueryData(["/api/stats"])).toEqual({ private: true })
		expect(invalidate).not.toHaveBeenCalled()
	})

	test("drops cached data and refreshes both access lists for an unrelated query", () => {
		const client = new QueryClient()
		const invalidate = spyOn(client, "invalidateQueries")
		client.setQueryData(["/api/stats"], { private: true })

		handleDeniedQueryError(client, deniedError(403), query(client, ["/api/stats"]))

		expect(client.getQueryData(["/api/stats"])).toBeUndefined()
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/agents"] })
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/me/permissions"] })
	})

	test("does not refetch the list whose own response was denied", () => {
		const client = new QueryClient()
		const invalidate = spyOn(client, "invalidateQueries")
		client.setQueryData(["/api/agents", { filters: "read" }], { private: true })

		handleDeniedQueryError(client, deniedError(404), query(client, ["/api/agents", { filters: "read" }]))

		expect(client.getQueryData(["/api/agents", { filters: "read" }])).toBeUndefined()
		expect(invalidate).toHaveBeenCalledTimes(1)
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/me/permissions"] })

		invalidate.mockClear()
		client.setQueryData(["/api/me/permissions"], { permissions: [] })
		handleDeniedQueryError(client, deniedError(403), query(client, ["/api/me/permissions"]))

		expect(client.getQueryData(["/api/me/permissions"])).toBeUndefined()
		expect(invalidate).toHaveBeenCalledTimes(1)
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/agents"] })
	})
})
