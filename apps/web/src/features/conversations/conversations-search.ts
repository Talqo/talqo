import { parseAgentsParam } from "@/features/statistics/agents-search"

export type ConversationsSearch = {
	agents?: string[]
	page?: number
}

export function parseConversationsSearch(search: Record<string, unknown>): ConversationsSearch {
	const page = typeof search.page === "number" ? search.page : Number(search.page)
	return {
		agents: parseAgentsParam(search.agents),
		page: Number.isInteger(page) && page > 1 ? page : undefined,
	}
}
