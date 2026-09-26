import type { GetStatsOverview200 } from "@/api/generated/models/stats/getStatsOverview200.zod"

export type StatsOverview = GetStatsOverview200["overview"]

export type DailyStatsPoint = {
	conversations: number
	date: string
	messages: number
	tokens: number
}

export type PageStats = {
	conversations: number
	messages: number
	tokens: number
	daily: DailyStatsPoint[]
}

// The wire shape keeps input/output tokens separate; the visualization tracks one token metric.
export function toPageStats(overview: StatsOverview): PageStats {
	return {
		conversations: overview.totals.conversations,
		messages: overview.totals.messages,
		tokens: overview.totals.inputTokens + overview.totals.outputTokens,
		daily: overview.daily.map((point) => ({
			date: point.date,
			conversations: point.conversations,
			messages: point.messages,
			tokens: point.inputTokens + point.outputTokens,
		})),
	}
}
