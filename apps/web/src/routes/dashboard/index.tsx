import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetStatsOverview } from "@/api/generated/stats/stats.ts"
import { PageHeader } from "@/components/page-header"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { AgentFilter } from "@/features/statistics/components/agent-filter"
import {
	agentLineColor,
	DailyStatsChart,
	StatsMetricCards,
	statsMetricKeys,
	useCompactNumber,
	type AgentLine,
	type StatsMetric,
} from "@/features/statistics/components/stats-charts"
import { toAgentBreakdown, toAgentDailyPoints, toSelectedStats } from "@/features/statistics/page-stats"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

const FORBIDDEN_STATUS = 403
const STATS_DAYS = 30
const ZERO_BREAKDOWN_TOTALS = { conversations: 0, messages: 0, tokens: 0 }

export const Route = createFileRoute("/dashboard/")({
	// The declared return type keeps the filter optional so plain `to: "/dashboard"` links keep working.
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
	const navigate = useNavigate()
	const { agents: searchAgents } = Route.useSearch()
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
	const selectedIds = useMemo(
		() => (searchAgents ?? allIds).filter((id) => (allAgents ?? []).some((agent) => agent.id === id)),
		[searchAgents, allIds, allAgents],
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

	function setSelected(ids: string[]) {
		void navigate({
			to: ".",
			search: (previous: Record<string, unknown>) => ({
				...previous,
				// Selecting everything is the default view; the URL stays clean.
				agents: ids.length === allIds.length ? undefined : ids,
			}),
			replace: true,
		})
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
					<AgentFilter agentLines={agentLines} selectedIds={selectedIds} onChange={setSelected} />

					{selectedIds.length === 0 ? (
						<p className="text-muted-foreground">{t("dashboard.noAgentsSelected")}</p>
					) : (
						<>
							<StatsMetricCards
								stats={stats}
								labels={labels}
								cardDescription={(metric) => t("dashboard.last30Days", { metric })}
							/>

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
