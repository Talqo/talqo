import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetStatsOverview } from "@/api/generated/stats/stats.ts"
import { PageHeader } from "@/components/page-header"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { requirePermission } from "@/features/permissions/require-permission"
import { parseAgentsParam } from "@/features/statistics/agents-search"
import { AgentFilter } from "@/features/statistics/components/agent-filter"
import { RangeFilter } from "@/features/statistics/components/range-filter"
import {
	agentLineColor,
	DailyStatsChart,
	StatsCards,
	statsMetricKeys,
	useCompactNumber,
	type AgentLine,
	type StatsCard,
	type StatsMetric,
} from "@/features/statistics/components/stats-charts"
import { toAgentDailyPoints, toSelectedStats } from "@/features/statistics/page-stats"
import { DEFAULT_STATS_DAYS, parseDaysParam, type StatsDays } from "@/features/statistics/ranges"
import { getProblemMessage } from "@/lib/problem-message"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

const FORBIDDEN_STATUS = 403
const CLIENT_ERROR_STATUS_MIN = 400
const CLIENT_ERROR_STATUS_MAX = 499
// The active-conversation card stays live without a manual refresh; one minute matches the
// metric's own granularity.
const STATS_REFRESH_MS = 60_000
const DEFAULT_QUERY_RETRIES = 3

export const Route = createFileRoute("/dashboard/")({
	beforeLoad: requirePermission("agents:read"),
	validateSearch: (search: Record<string, unknown>): { agents?: string[]; days?: StatsDays } => ({
		agents: parseAgentsParam(search.agents),
		days: parseDaysParam(search.days),
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

// 4xx responses never clear on retry, so a denied or rejected request fails fast instead of
// burning the default retry backoff before the error state renders.
function retryUnlessClientError(failureCount: number, error: { status?: number }): boolean {
	if (
		error.status !== undefined &&
		error.status >= CLIENT_ERROR_STATUS_MIN &&
		error.status <= CLIENT_ERROR_STATUS_MAX
	) {
		return false
	}
	return failureCount < DEFAULT_QUERY_RETRIES
}

function DashboardIndexPage() {
	const { t } = useTranslation()
	// The agent and range selections live in ?agents= and ?days= so a filtered view is
	// shareable; a missing param means every agent / the default range. Toggles replace the
	// URL entry and never move the scroll.
	const search = Route.useSearch()
	const days = search.days ?? DEFAULT_STATS_DAYS
	const statsQuery = useGetStatsOverview(
		{ days },
		{ query: { refetchInterval: STATS_REFRESH_MS, retry: retryUnlessClientError } },
	)
	const agentsQuery = useListAgents({ query: { retry: retryUnlessClientError } })
	const labels = metricLabels(t)
	const compactNumber = useCompactNumber()

	const { error, isLoading } = statsQuery
	const overview = statsQuery.data?.data.overview
	const allAgents = agentsQuery.data?.data.agents
	// The selection box covers every workspace agent; agents without activity simply add zero points.
	const allIds = useMemo(() => (allAgents ?? []).map((agent) => agent.id), [allAgents])
	const agentLines = useMemo<AgentLine[]>(
		() => (allAgents ?? []).map((agent, index) => ({ color: agentLineColor(index), id: agent.id, name: agent.name })),
		[allAgents],
	)
	const selection = search.agents
	const navigate = useNavigate({ from: Route.fullPath })
	const setSelection = (ids: string[]) => {
		void navigate({
			replace: true,
			resetScroll: false,
			search: (prev) => ({ ...prev, agents: ids.length === allIds.length ? undefined : ids }),
		})
	}
	const setRange = (next: StatsDays) => {
		void navigate({
			replace: true,
			resetScroll: false,
			search: (prev) => ({ ...prev, days: next === DEFAULT_STATS_DAYS ? undefined : next }),
		})
	}
	const selectedIds = useMemo(() => (selection ?? allIds).filter((id) => allIds.includes(id)), [selection, allIds])
	const allSelected = selectedIds.length === allIds.length
	const selectedLines = useMemo(
		() => agentLines.filter((line) => selectedIds.includes(line.id)),
		[agentLines, selectedIds],
	)
	const dailyPoints = useMemo(() => (overview ? toAgentDailyPoints(overview) : []), [overview])
	const stats = useMemo(
		() => (overview ? toSelectedStats(overview, selectedIds, allSelected) : undefined),
		[overview, selectedIds, allSelected],
	)
	const cards = useMemo<StatsCard[]>(() => {
		if (!overview || !stats) return []
		const cardLabels = metricLabels(t)
		const activeByAgent = new Map(overview.active.map((row) => [row.agentId, row.conversations]))
		const activeTotal = selectedIds.reduce((sum, id) => sum + (activeByAgent.get(id) ?? 0), 0)
		const perConversation = (numerator: number) => (stats.conversations === 0 ? 0 : numerator / stats.conversations)
		return [
			{ format: "compact", label: cardLabels.conversations, value: stats.conversations },
			{ format: "compact", label: cardLabels.messages, value: stats.messages },
			{ format: "compact", label: cardLabels.tokens, value: stats.tokens },
			{
				format: "compact",
				label: t("dashboard.recentMinutes", {
					metric: t("dashboard.activeConversations"),
					minutes: overview.activeWindowMinutes,
				}),
				value: activeTotal,
			},
			{ format: "decimal", label: t("dashboard.messagesPerConversation"), value: perConversation(stats.messages) },
			{ format: "compact", label: t("dashboard.tokensPerConversation"), value: perConversation(stats.tokens) },
		]
	}, [overview, stats, selectedIds, t])
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

	if (error?.status === FORBIDDEN_STATUS || agentsQuery.error?.status === FORBIDDEN_STATUS) {
		return (
			<div className="mx-auto max-w-5xl space-y-6">
				<PageHeader title={t("dashboard.heading")} description={t("dashboard.subheading")} />
				<AccessDenied />
			</div>
		)
	}

	if (error || agentsQuery.error) {
		return (
			<div className="mx-auto max-w-5xl space-y-6">
				<PageHeader title={t("dashboard.heading")} description={t("dashboard.subheading")} />
				<div className="space-y-2">
					<p role="alert" className="text-destructive text-sm">
						{getProblemMessage(error ?? agentsQuery.error, t, t("dashboard.loadFailed"))}
					</p>
					<Button
						variant="outline"
						onClick={() => {
							statsQuery.refetch()
							agentsQuery.refetch()
						}}
						disabled={statsQuery.isFetching || agentsQuery.isFetching}
					>
						{t("dashboard.retry")}
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<PageHeader title={t("dashboard.heading")} description={t("dashboard.subheading")} />

			{isLoading || agentsQuery.isLoading || !overview || !stats ? (
				<p className="text-muted-foreground">{t("dashboard.loading")}</p>
			) : allAgents?.length === 0 ? (
				<div className="space-y-4">
					<p className="text-muted-foreground">{t("dashboard.noAgents")}</p>
					<Button variant="outline" render={<Link to="/dashboard/agents" />}>
						<Plus className="size-4" />
						{t("agents.create")}
					</Button>
				</div>
			) : allSelected && stats.conversations === 0 && stats.messages === 0 && stats.tokens === 0 ? (
				// The empty state only applies to the unfiltered view; a user-driven selection
				// keeps the filter on screen with its own "no agents selected" guidance.
				<p className="text-muted-foreground">{t("dashboard.empty")}</p>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
						<AgentFilter agentLines={agentLines} selectedIds={selectedIds} onChange={setSelection} />
						<RangeFilter days={days} onChange={setRange} />
					</div>

					{selectedIds.length === 0 ? (
						<p className="text-muted-foreground">{t("dashboard.noAgentsSelected")}</p>
					) : (
						<>
							<StatsCards cards={cards} />

							<Card>
								<CardHeader>
									<CardTitle>{t("dashboard.usageOverTime")}</CardTitle>
								</CardHeader>
								<CardContent>
									<DailyStatsChart
										daily={stats.daily}
										agentDaily={dailyPoints}
										agentLines={selectedLines}
										labels={labels}
										totalLabel={t("dashboard.total")}
										chartTitle={(metricLabel) => t("dashboard.chartTitle", { metric: metricLabel })}
										chartDescription={t("dashboard.chartDescription")}
									/>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle>{t("dashboard.perAgentTitle")}</CardTitle>
									<CardDescription>{t("dashboard.perAgentDescription")}</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="overflow-x-auto">
										<table className="w-full text-sm">
											<caption className="sr-only">{t("dashboard.perAgentCaption")}</caption>
											<thead>
												<tr className="text-muted-foreground border-b text-left">
													<th scope="col" className="pb-2 font-medium">
														{t("dashboard.agentColumn")}
													</th>
													{statsMetricKeys.map((metric) => (
														<th key={metric} scope="col" className="pb-2 text-right font-medium">
															{labels[metric]}
														</th>
													))}
												</tr>
											</thead>
											<tbody>
												{breakdownAgents.map((agent) => (
													<tr key={agent.id} className="border-b last:border-0">
														<td className="py-2 font-medium">
															<span className="flex items-center gap-2">
																<span
																	aria-hidden
																	className="size-2 shrink-0 rounded-full"
																	style={{ background: agent.color }}
																/>
																{agent.name}
															</span>
														</td>
														<td className="py-2 text-right tabular-nums">
															{compactNumber.format(agent.conversations)}
														</td>
														<td className="py-2 text-right tabular-nums">{compactNumber.format(agent.messages)}</td>
														<td className="py-2 text-right tabular-nums">{compactNumber.format(agent.tokens)}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</CardContent>
							</Card>
						</>
					)}
				</>
			)}
		</div>
	)
}
