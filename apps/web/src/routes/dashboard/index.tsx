import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetStatsOverview } from "@/api/generated/stats/stats.ts"
import { PageHeader } from "@/components/page-header"
import { ProviderNoticeBanner } from "@/features/ai-configuration/provider-notice-banner"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { requirePermission } from "@/features/permissions/require-permission"
import { parseAgentsParam } from "@/features/statistics/agents-search"
import { AgentFilter } from "@/features/statistics/components/agent-filter"
import { RangeFilter } from "@/features/statistics/components/range-filter"
import {
	type AgentLine,
	agentLineColor,
	agentLineDashPattern,
	DailyStatsChart,
	type StatsCard,
	StatsCards,
	type StatsMetric,
	statsMetricKeys,
	useCompactNumber,
} from "@/features/statistics/components/stats-charts"
import { toAgentDailyPoints, toSelectedStats } from "@/features/statistics/page-stats"
import { DEFAULT_STATS_DAYS, parseDaysParam, type StatsDays } from "@/features/statistics/ranges"
import { formatTime } from "@/lib/format-date"
import { getProblemMessage } from "@/lib/problem-message"
import { retryUnlessClientError } from "@/lib/query-retry"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

const FORBIDDEN_STATUS = 403
// The active-conversation card stays live without a manual refresh; one minute matches the
// metric's own granularity.
const STATS_REFRESH_MS = 60_000

export const Route = createFileRoute("/dashboard/")({
	validateSearch: (search: Record<string, unknown>): { agents?: string[]; days?: StatsDays } => ({
		agents: parseAgentsParam(search.agents),
		days: parseDaysParam(search.days),
	}),
	beforeLoad: requirePermission("stats:read"),
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
	const labels = useMemo(() => metricLabels(t), [t])
	const compactNumber = useCompactNumber()
	const { language } = useLanguage()

	const { error, isLoading } = statsQuery
	const overview = statsQuery.data?.data.overview
	const allAgents = agentsQuery.data?.data.agents.filter((agent) => agent.permissions.includes("stats:read"))
	// Agents without activity still belong in the permitted statistics filter.
	const allIds = useMemo(() => (allAgents ?? []).map((agent) => agent.id), [allAgents])
	const agentLines = useMemo<AgentLine[]>(
		() =>
			(allAgents ?? []).map((agent, index) => ({
				color: agentLineColor(index),
				dash: agentLineDashPattern(index),
				id: agent.id,
				name: agent.name,
			})),
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
	const stats = useMemo(() => (overview ? toSelectedStats(overview, selectedIds) : undefined), [overview, selectedIds])
	const updatedAt = new Date(statsQuery.dataUpdatedAt).toISOString()
	const cardGroups = useMemo<{ primary: StatsCard[]; secondary: StatsCard[] }>(() => {
		if (!overview || !stats) return { primary: [], secondary: [] }
		const activeByAgent = new Map(overview.active.map((row) => [row.agentId, row.conversations]))
		const activeTotal = selectedIds.reduce((sum, id) => sum + (activeByAgent.get(id) ?? 0), 0)
		const perConversation = (value: number) => (stats.conversations === 0 ? 0 : value / stats.conversations)
		return {
			primary: [
				{ format: "compact", label: labels.conversations, value: stats.conversations },
				{ format: "compact", label: labels.messages, value: stats.messages },
				{
					format: "compact",
					label: t("dashboard.recentMinutes", {
						metric: t("dashboard.activeConversations"),
						minutes: overview.activeWindowMinutes,
					}),
					value: activeTotal,
				},
			],
			secondary: [
				{ format: "compact", label: labels.tokens, value: stats.tokens },
				{ format: "decimal", label: t("dashboard.messagesPerConversation"), value: perConversation(stats.messages) },
				{ format: "decimal", label: t("dashboard.tokensPerConversation"), value: perConversation(stats.tokens) },
			],
		}
	}, [overview, stats, selectedIds, labels, t])
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
			<div className="space-y-6">
				<PageHeader title={t("dashboard.heading")} description={t("dashboard.subheading")} />
				<AccessDenied />
			</div>
		)
	}

	if (error || agentsQuery.error) {
		return (
			<div className="space-y-6">
				<PageHeader title={t("dashboard.heading")} description={t("dashboard.subheading")} />
				<div className="space-y-2">
					<p role="alert" className="text-destructive text-sm">
						{getProblemMessage(error ?? agentsQuery.error, t, t("dashboard.loadFailed"))}
					</p>
					<Button
						variant="outline"
						onClick={() => {
							void statsQuery.refetch()
							void agentsQuery.refetch()
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
		<div className="space-y-6">
			<PageHeader title={t("dashboard.heading")} description={t("dashboard.subheading")} />

			<ProviderNoticeBanner />

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
						<p className="text-muted-foreground ms-auto text-sm">
							{t("dashboard.lastUpdated")} <time dateTime={updatedAt}>{formatTime(updatedAt, language)}</time>
						</p>
					</div>

					{selectedIds.length === 0 ? (
						<p className="text-muted-foreground">{t("dashboard.noAgentsSelected")}</p>
					) : (
						<>
							<StatsCards cards={cardGroups.primary} />
							<section className="space-y-3" aria-labelledby="dashboard-usage-details">
								<h2 id="dashboard-usage-details" className="text-muted-foreground text-sm font-medium">
									{t("dashboard.usageDetails")}
								</h2>
								<StatsCards cards={cardGroups.secondary} />
							</section>

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
														<th scope="row" className="py-2 text-left font-medium">
															<span className="flex items-center gap-2">
																<span
																	aria-hidden
																	className="size-2 shrink-0 rounded-full"
																	style={{ background: agent.color }}
																/>
																{agent.name}
															</span>
														</th>
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
