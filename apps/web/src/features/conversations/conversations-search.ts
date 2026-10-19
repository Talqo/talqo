import { parseAgentsParam } from "@/features/statistics/agents-search"

// The list state rides in search params so a transcript's back link and a shared link reopen the same page.
export type ConversationsSearch = {
	agents?: string[]
	attention?: true
	page?: number
}

export function parseConversationsSearch(search: Record<string, unknown>): ConversationsSearch {
	const page = typeof search.page === "number" ? search.page : Number(search.page)
	return {
		agents: parseAgentsParam(search.agents),
		attention: search.attention === true || search.attention === "true" ? true : undefined,
		page: Number.isInteger(page) && page > 1 ? page : undefined,
	}
}
