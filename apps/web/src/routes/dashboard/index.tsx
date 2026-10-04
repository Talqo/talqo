import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetStatsOverview } from "@/api/generated/stats/stats.ts"
import { PageHeader } from "@/components/page-header"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { AgentFilter } from "@/features/statistics/components/agent-filter"
import {
	agentLineColor,
	DailyStatsChart,
	StatsInsightCards,
	StatsMetricCards,
	statsMetricKeys,
	useCompactNumber,
	type AgentLine,
	type StatsMetric,
} from "@/features/statistics/components/stats-charts"
import { toAgentBreakdown, toAgentDailyPoints, toSelectedStats } from "@/features/statistics/page-stats"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

const FORBIDDEN_STATUS = 403
const STATS_DAYS = 30
const ZERO_BREAKDOWN_TOTALS = { conversations: 0, messages: 0, tokens: 0 }

export const Route = createFileRoute("/dashboard/")({
	// The optional filter only seeds the initial selection (e.g. the analytics redirect); picking
	// agents stays in local state afterwards. The declared return type keeps plain
	// `to: "/dashboard"` links working.
	validateSearch: (search: Record<string, unknown>): { agents?: string[] } => ({
		agents: Array.isArray(search.agents)
			? search.agents.filter((id): id is string => typeof id === "string")
			: undefined,
	}),
	component: DashboardIndexPage,
})

function metricLabels(t: (key: string) => string): Record<StatsMetric, string> {
	return {
		conversations: t("dashboard.conversations"),
		messages: t("dashboard.messages"),
		tokens: t("dashboard.tokens"),
	}
}

function DashboardIndexPage() {
	const { t } = useTranslation()
	const { agents: initialAgents } = Route.useSearch()
	const { data, error, isLoading } = useGetStatsOverview({ days: STATS_DAYS })
	const agentsQuery = useListAgents()
	const labels = metricLabels(t)
	const compactNumber = useCompactNumber()

	const overview = data?.data.overview
	const allAgents = agentsQuery.data?.data.agents
	// The selection box covers every workspace agent; agents without activity simply add zero points.
	const allIds = useMemo(() => (allAgents ?? []).map((agent) => agent.id), [allAgents])
	const agentLines = useMemo<AgentLine[]>(
		() => (allAgents ?? []).map((agent, index) => ({ color: agentLineColor(index), id: agent.id, name: agent.name })),
		[allAgents],
	)
	// Picks stay local: toggling the filter must not rewrite the URL, reset the scroll
	// position, or lose the navigation highlight. `undefined` stands for "all agents".
	const [selection, setSelection] = useState<string[] | undefined>(initialAgents)
	const selectedIds = useMemo(
		() => (selection ?? allIds).filter((id) => (allAgents ?? []).some((agent) => agent.id === id)),
		[selection, allIds, allAgents],
	)
	const selectedLines = useMemo(
		() => agentLines.filter((line) => selectedIds.includes(line.id)),
		[agentLines, selectedIds],
	)
	const dailyPoints = useMemo(() => (overview ? toAgentDailyPoints(overview) : []), [overview])
	const axisDates = useMemo(() => overview?.daily.map((day) => day.date) ?? [], [overview])
	const stats = useMemo(
		() => (overview ? toSelectedStats(dailyPoints, axisDates, selectedIds) : undefined),
		[overview, dailyPoints, axisDates, selectedIds],
	)
	const insightCards = useMemo(() => {
		if (!overview || !stats) return []
		const activeByAgent = new Map(overview.active.map((row) => [row.agentId, row.conversations]))
		const activeTotal = selectedIds.reduce((sum, id) => sum + (activeByAgent.get(id) ?? 0), 0)
		const perConversation = (numerator: number) => (stats.conversations === 0 ? 0 : numerator / stats.conversations)
		return [
			{
				format: "compact" as const,
				label: t("dashboard.recentMinutes", {
					metric: t("dashboard.activeConversations"),
					minutes: overview.activeWindowMinutes,
				}),
				value: activeTotal,
			},
			{
				format: "decimal" as const,
				label: t("dashboard.last30Days", { metric: t("dashboard.messagesPerConversation") }),
				value: perConversation(stats.messages),
			},
			{
				format: "compact" as const,
				label: t("dashboard.last30Days", { metric: t("dashboard.tokensPerConversation") }),
				value: perConversation(stats.tokens),
			},
		]
	}, [overview, stats, selectedIds, t])
	// Cards, chart, and the breakdown table all read the same per-agent series.
	const totalsByAgent = useMemo(() => toAgentBreakdown(dailyPoints), [dailyPoints])
	// Every selected agent gets a row, zero-filled when it had no activity, so the
	// breakdown always mirrors the filter selection.
	const breakdownAgents = useMemo(
		() =>
			selectedLines
				.map((line) => ({ ...line, ...(totalsByAgent.get(line.id) ?? ZERO_BREAKDOWN_TOTALS) }))
				.toSorted((left, right) => left.name.localeCompare(right.name)),
		[selectedLines, totalsByAgent],
	)

	if (error?.status === FORBIDDEN_STATUS || agentsQuery.error?.status === FORBIDDEN_STATUS) {
		return (
			<div className="mx-auto max-w-5xl space-y-6">
				<PageHeader title={t("dashboard.heading")} description={t("dashboard.subheading")} />
				<AccessDenied />
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<PageHeader title={t("dashboard.heading")} description={t("dashboard.subheading")} />

			{isLoading || agentsQuery.isLoading || !overview || !stats ? (
				<p className="text-muted-foreground">{t("dashboard.loading")}</p>
			) : allAgents?.length === 0 ? (
				<p className="text-muted-foreground">{t("dashboard.empty")}</p>
			) : (
				<>
					<AgentFilter agentLines={agentLines} selectedIds={selectedIds} onChange={setSelection} />

					{selectedIds.length === 0 ? (
						<p className="text-muted-foreground">{t("dashboard.noAgentsSelected")}</p>
					) : (
						<>
							<StatsMetricCards
								stats={stats}
								labels={labels}
								cardDescription={(metric) => t("dashboard.last30Days", { metric })}
							/>

							<StatsInsightCards cards={insightCards} />

							<Card>
								<CardHeader>
									<CardTitle>{t("dashboard.usageOverTime")}</CardTitle>
									<CardDescription>{t("dashboard.dailyTotals")}</CardDescription>
								</CardHeader>
								<CardContent>
									<DailyStatsChart
										daily={stats.daily}
										agentDaily={dailyPoints}
										agentLines={selectedLines}
										labels={labels}
										totalLabel={t("dashboard.total")}
									/>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle>{t("dashboard.perAgentTitle")}</CardTitle>
									<CardDescription>{t("dashboard.perAgentDescription")}</CardDescription>
								</CardHeader>
								<CardContent>
									<table className="w-full text-sm">
										<thead>
											<tr className="text-muted-foreground border-b text-left">
												<th className="pb-2 font-medium">{t("dashboard.agentColumn")}</th>
												{statsMetricKeys.map((metric) => (
													<th key={metric} className="pb-2 text-right font-medium">
														{labels[metric]}
													</th>
												))}
											</tr>
										</thead>
										<tbody>
											{breakdownAgents.map((agent) => (
												<tr key={agent.id} className="border-b last:border-0">
													<td className="py-2 font-medium">{agent.name}</td>
													<td className="py-2 text-right tabular-nums">{compactNumber.format(agent.conversations)}</td>
													<td className="py-2 text-right tabular-nums">{compactNumber.format(agent.messages)}</td>
													<td className="py-2 text-right tabular-nums">{compactNumber.format(agent.tokens)}</td>
												</tr>
											))}
										</tbody>
									</table>
								</CardContent>
							</Card>
						</>
					)}
				</>
			)}
		</div>
	)
}
