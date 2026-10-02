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

export type AgentBreakdownTotals = {
	conversations: number
	messages: number
	tokens: number
}

// The wire shape keeps input/output tokens separate; the visualization tracks one token metric.
// The per-agent series is sparse server-side: days without activity have no row. An older API
// deployment may not return it yet, so tolerate its absence instead of crashing the page.
export function toAgentDailyPoints(overview: StatsOverview): AgentDailyPoint[] {
	return (overview.agentDaily ?? []).map((point) => ({
		agentId: point.agentId,
		date: point.date,
		conversations: point.conversations,
		messages: point.messages,
		tokens: point.inputTokens + point.outputTokens,
	}))
}

// Per-agent sums over the window; agents appear only when they had activity.
export function toAgentBreakdown(points: AgentDailyPoint[]): Map<string, AgentBreakdownTotals> {
	const totals = new Map<string, AgentBreakdownTotals>()
	for (const point of points) {
		const agent = totals.get(point.agentId) ?? { conversations: 0, messages: 0, tokens: 0 }
		agent.conversations += point.conversations
		agent.messages += point.messages
		agent.tokens += point.tokens
		totals.set(point.agentId, agent)
	}
	return totals
}

// Aggregates the selected agents into the card totals and the dense "total" daily series.
// The date axis comes from dates so zero-activity days stay on the chart.
export function toSelectedStats(points: AgentDailyPoint[], dates: string[], selectedIds: string[]): PageStats {
	const selected = new Set(selectedIds)
	const byDate = new Map<string, DailyStatsPoint>(
		dates.map((date) => [date, { date, conversations: 0, messages: 0, tokens: 0 }]),
	)
	for (const point of points) {
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
