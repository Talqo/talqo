import type { GetStatsOverview200 } from "@/api/generated/models/stats/getStatsOverview200.zod"

export type StatsOverview = GetStatsOverview200["overview"]

export type DailyStatsPoint = {
	conversations: number
	date: string
	messages: number
	tokens: number
}

export type AgentDailyPoint = DailyStatsPoint & {
	agentId: string
}

export type PageStats = {
	conversations: number
	messages: number
	tokens: number
	daily: DailyStatsPoint[]
}

// The wire shape keeps input/output tokens separate; the visualization tracks one token metric.
// The per-agent series is sparse server-side: days without activity have no row, and the
// consumer zero-fills against the dense date axis.
export function toAgentDailyPoints(overview: StatsOverview): AgentDailyPoint[] {
	return overview.agentDaily.map((point) => ({
		agentId: point.agentId,
		date: point.date,
		conversations: point.conversations,
		messages: point.messages,
		tokens: point.inputTokens + point.outputTokens,
	}))
}

// Aggregates the selection into the card totals and the dense "total" daily series. The
// unfiltered view consumes the server's own contract-tested totals and daily axis verbatim;
// a subset re-aggregates the sparse per-agent series client-side, zero-filled per axis date so
// days without activity stay on the chart.
export function toSelectedStats(overview: StatsOverview, selectedIds: string[], allSelected: boolean): PageStats {
	if (allSelected) {
		return {
			conversations: overview.totals.conversations,
			messages: overview.totals.messages,
			tokens: overview.totals.inputTokens + overview.totals.outputTokens,
			daily: overview.daily.map((day) => ({
				date: day.date,
				conversations: day.conversations,
				messages: day.messages,
				tokens: day.inputTokens + day.outputTokens,
			})),
		}
	}
	const selected = new Set(selectedIds)
	const byDate = new Map<string, DailyStatsPoint>(
		overview.daily.map((day) => [day.date, { date: day.date, conversations: 0, messages: 0, tokens: 0 }]),
	)
	for (const point of toAgentDailyPoints(overview)) {
		if (!selected.has(point.agentId)) continue
		const day = byDate.get(point.date)
		if (!day) continue
		day.conversations += point.conversations
		day.messages += point.messages
		day.tokens += point.tokens
	}
	const stats: PageStats = { conversations: 0, messages: 0, tokens: 0, daily: [] }
	for (const day of byDate.values()) {
		stats.daily.push(day)
		stats.conversations += day.conversations
		stats.messages += day.messages
		stats.tokens += day.tokens
	}
	return stats
}
