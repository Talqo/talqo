import { useListAgents } from "@/api/generated/agent/agent.ts"
import { agentLineColor } from "@/features/statistics/components/stats-charts"
import { useEffect, useMemo } from "react"

import type { ConversationsSearch } from "./conversations-search"

/** Drops unreadable IDs. Undefined means all agents; an unchanged selection keeps its reference. */
function reconcileAgentIds(
	requested: Array<string> | undefined,
	readableIds: Array<string>,
): Array<string> | undefined {
	if (requested === undefined || requested.length === 0) return requested
	const valid = requested.filter((id) => readableIds.includes(id))
	if (valid.length === requested.length) return requested
	return valid.length === 0 ? undefined : valid
}

/** Keeps the ?agents= filter limited to agents the operator can read, rewriting the URL when it changes. */
export function useConversationFilters(
	search: ConversationsSearch,
	onSearchChange: (search: ConversationsSearch) => void,
) {
	const agentsQuery = useListAgents()
	const agentLines = useMemo(
		() =>
			(agentsQuery.data?.data.agents ?? [])
				.filter((agent) => agent.permissions.includes("conversations:read"))
				.map((agent, index) => ({
					id: agent.id,
					name: agent.name,
					color: agentLineColor(index),
				})),
		[agentsQuery.data],
	)
	const agentNames = useMemo(() => new Map(agentLines.map((line) => [line.id, line.name])), [agentLines])
	const readableIds = useMemo(() => agentLines.map((line) => line.id), [agentLines])
	const agentsLoaded = agentsQuery.data !== undefined
	const effectiveAgents = useMemo(
		() => (agentsLoaded ? reconcileAgentIds(search.agents, readableIds) : search.agents),
		[agentsLoaded, search.agents, readableIds],
	)
	const filterChanged = effectiveAgents !== search.agents
	const noAgentSelected = effectiveAgents?.length === 0
	// A filtered URL waits for the agent list instead of querying unreadable IDs first.
	const awaitingAgents = agentsQuery.isPending && (search.agents?.length ?? 0) > 0

	useEffect(() => {
		if (!agentsLoaded || effectiveAgents === search.agents) return
		onSearchChange({ ...search, agents: effectiveAgents, page: undefined })
	}, [agentsLoaded, effectiveAgents, onSearchChange, search])

	return {
		agentLines,
		agentNames,
		awaitingAgents,
		effectiveAgents,
		filterChanged,
		noAgentSelected,
		selectedIds: effectiveAgents ?? readableIds,
	}
}
