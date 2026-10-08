import * as agentService from "@/modules/agent/agent.service.ts"
import * as conversationService from "@/modules/conversation/conversation.service.ts"
import * as usageService from "@/modules/usage/usage.service.ts"

export type StatsOverviewQuery = {
	agentId?: string
	days: number
}

type StatsActiveConversations = {
	agentId: string
	conversations: number
}

type StatsDailyPoint = {
	conversations: number
	date: string
	inputTokens: number
	messages: number
	outputTokens: number
}

type StatsAgentTotals = {
	agentId: string
	agentName: string
	conversations: number
	inputTokens: number
	messages: number
	outputTokens: number
}

type StatsAgentDailyPoint = StatsDailyPoint & {
	agentId: string
}

export type StatsOverview = {
	active: StatsActiveConversations[]
	activeWindowMinutes: number
	agentDaily: StatsAgentDailyPoint[]
	agents: StatsAgentTotals[]
	daily: StatsDailyPoint[]
	days: number
	totals: {
		conversations: number
		inputTokens: number
		messages: number
		outputTokens: number
	}
}

const MILLISECONDS_PER_MINUTE = 60_000
const MILLISECONDS_PER_DAY = 86_400_000
// "Active" means any recorded message inside this rolling window; the client labels it verbatim.
const ACTIVE_CONVERSATION_WINDOW_MINUTES = 60

function utcDateKey(date: Date): string {
	return date.toISOString().slice(0, "YYYY-MM-DD".length)
}

// The sparse per-agent-day rows are the single source; totals, the dense daily axis, and the
// per-agent breakdown are all derived from them so the views can never disagree.
export async function getStatsOverview(query: StatsOverviewQuery): Promise<StatsOverview> {
	const since = new Date(Date.now() - (query.days - 1) * MILLISECONDS_PER_DAY)
	since.setUTCHours(0, 0, 0, 0)
	const activeCutoff = new Date(Date.now() - ACTIVE_CONVERSATION_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE)
	const [conversationCounts, messageCounts, usageTotals, activeCounts, agents] = await Promise.all([
		conversationService.getDailyConversationCountsByAgent(since),
		conversationService.getDailyMessageCountsByAgent(since),
		usageService.getDailyUsageTotalsByAgent(since),
		conversationService.getActiveConversationCountsByAgent(activeCutoff),
		agentService.listAgents(),
	])
	const active: StatsActiveConversations[] = activeCounts.map((row) => ({
		agentId: row.agentId,
		conversations: row.count,
	}))
	const byAgentDay = new Map<string, Map<string, StatsAgentDailyPoint>>()
	const dayPoint = (agentId: string, date: string): StatsAgentDailyPoint => {
		let byDay = byAgentDay.get(agentId)
		if (!byDay) {
			byDay = new Map()
			byAgentDay.set(agentId, byDay)
		}
		let point = byDay.get(date)
		if (!point) {
			point = { agentId, date, conversations: 0, messages: 0, inputTokens: 0, outputTokens: 0 }
			byDay.set(date, point)
		}
		return point
	}
	for (const row of conversationCounts) dayPoint(row.agentId, row.date).conversations += row.count
	for (const row of messageCounts) dayPoint(row.agentId, row.date).messages += row.count
	for (const row of usageTotals) {
		const point = dayPoint(row.agentId, row.date)
		point.inputTokens += row.inputTokens
		point.outputTokens += row.outputTokens
	}
	const agentDaily: StatsAgentDailyPoint[] = []
	for (const byDay of byAgentDay.values()) {
		agentDaily.push(...byDay.values())
	}
	agentDaily.sort((left, right) => left.agentId.localeCompare(right.agentId) || left.date.localeCompare(right.date))

	const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]))
	const agentTotals: StatsAgentTotals[] = []
	for (const [agentId, byDay] of byAgentDay) {
		const totalsRow: StatsAgentTotals = {
			agentId,
			agentName: agentNames.get(agentId) ?? agentId,
			conversations: 0,
			messages: 0,
			inputTokens: 0,
			outputTokens: 0,
		}
		for (const point of byDay.values()) {
			totalsRow.conversations += point.conversations
			totalsRow.messages += point.messages
			totalsRow.inputTokens += point.inputTokens
			totalsRow.outputTokens += point.outputTokens
		}
		agentTotals.push(totalsRow)
	}
	agentTotals.sort((left, right) => left.agentName.localeCompare(right.agentName))

	// The optional agent filter scopes only the dense daily axis and the overall totals;
	// the per-agent series and breakdown stay global for client-side selection.
	const axisTotals = new Map<string, StatsDailyPoint>()
	for (const point of agentDaily) {
		if (query.agentId && point.agentId !== query.agentId) continue
		const day = axisTotals.get(point.date) ?? {
			date: point.date,
			conversations: 0,
			messages: 0,
			inputTokens: 0,
			outputTokens: 0,
		}
		day.conversations += point.conversations
		day.messages += point.messages
		day.inputTokens += point.inputTokens
		day.outputTokens += point.outputTokens
		axisTotals.set(point.date, day)
	}
	const daily: StatsDailyPoint[] = []
	const totals = {
		conversations: 0,
		messages: 0,
		inputTokens: 0,
		outputTokens: 0,
	}
	// The daily series stays dense so charts render zero-activity days.
	for (let offset = 0; offset < query.days; offset += 1) {
		const date = utcDateKey(new Date(since.getTime() + offset * MILLISECONDS_PER_DAY))
		const day = axisTotals.get(date) ?? { date, conversations: 0, messages: 0, inputTokens: 0, outputTokens: 0 }
		daily.push(day)
		totals.conversations += day.conversations
		totals.messages += day.messages
		totals.inputTokens += day.inputTokens
		totals.outputTokens += day.outputTokens
	}
	return {
		active,
		activeWindowMinutes: ACTIVE_CONVERSATION_WINDOW_MINUTES,
		agentDaily,
		agents: agentTotals,
		daily,
		days: query.days,
		totals,
	}
}
