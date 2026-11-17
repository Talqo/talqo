import type { AgentLine } from "@/features/statistics/components/stats-charts"
import type { AgentDailyPoint, PageStats, StatsOverview } from "@/features/statistics/page-stats"

import { toAgentDailyPoints, toSelectedStats } from "@/features/statistics/page-stats"
import { useMemo } from "react"

export type BreakdownAgent = AgentLine & { conversations: number; messages: number; tokens: number }

type DashboardUsage = {
	breakdownAgents: BreakdownAgent[]
	dailyPoints: AgentDailyPoint[]
	rangeIsEmpty: boolean
	selectedIds: string[]
	selectedLines: AgentLine[]
	stats: PageStats | undefined
}

/** Derives every value the dashboard reads from the stats overview and the agent selection. */
export function useDashboardUsage({
	overview,
	agentLines,
	selection,
	allIds,
}: {
	overview: StatsOverview | undefined
	agentLines: AgentLine[]
	selection: string[] | undefined
	allIds: string[]
}): DashboardUsage {
	const selectedIds = useMemo(
		() => [...new Set((selection ?? allIds).filter((id) => allIds.includes(id)))],
		[selection, allIds],
	)
	const selectedLines = useMemo(
		() => agentLines.filter((line) => selectedIds.includes(line.id)),
		[agentLines, selectedIds],
	)
	const dailyPoints = useMemo(() => (overview ? toAgentDailyPoints(overview) : []), [overview])
	const stats = useMemo(() => (overview ? toSelectedStats(overview, selectedIds) : undefined), [overview, selectedIds])
	// The breakdown table reads the server's own per-agent totals; only the zero rows for
	// selected agents without activity are filled client-side.
	const serverAgentTotals = useMemo(
		() => new Map((overview?.agents ?? []).map((row) => [row.agentId, row])),
		[overview],
	)
	// Every selected agent gets a row, zero-filled when it had no activity, so the
	// breakdown always mirrors the filter selection.
	const breakdownAgents = useMemo(
		() =>
			selectedLines
				.map((line) => {
					const row = serverAgentTotals.get(line.id)
					return {
						...line,
						conversations: row?.conversations ?? 0,
						messages: row?.messages ?? 0,
						tokens: row ? row.inputTokens + row.outputTokens : 0,
					}
				})
				.toSorted((left, right) => left.name.localeCompare(right.name)),
		[selectedLines, serverAgentTotals],
	)
	const allSelected = selectedIds.length === allIds.length
	const rangeIsEmpty =
		stats !== undefined && allSelected && stats.conversations === 0 && stats.messages === 0 && stats.tokens === 0
	return { breakdownAgents, dailyPoints, rangeIsEmpty, selectedIds, selectedLines, stats }
}
