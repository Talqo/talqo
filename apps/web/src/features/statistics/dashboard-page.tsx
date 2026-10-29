import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { useGetStatsOverview } from "@/api/generated/stats/stats.ts"
import { PageHeader } from "@/components/page-header"
import { ProblemAlert } from "@/components/problem-alert"
import { useCreateAgentFlow } from "@/features/agents/use-create-agent-flow"
import { ProviderNoticeBanner } from "@/features/ai-configuration/provider-notice-banner"
import { AccessDenied } from "@/features/permissions/components/access-denied"
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
import {
	type AgentDailyPoint,
	type PageStats,
	type StatsOverview,
	toAgentDailyPoints,
	toSelectedStats,
} from "@/features/statistics/page-stats"
import { DEFAULT_STATS_DAYS, STATS_RANGE_LABELS, type StatsDays } from "@/features/statistics/ranges"
import { formatTime } from "@/lib/format-date"
import { retryUnlessClientError } from "@/lib/query-retry"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { EmptyState } from "@talqo/ui/components/empty-state"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { Bot, ChartColumn, Plus } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

const FORBIDDEN_STATUS = 403
// The active-conversation card stays live without a manual refresh; one minute matches the
// metric's own granularity.
const STATS_REFRESH_MS = 60_000

export type DashboardSearch = { agents?: string[]; days?: StatsDays }

function metricLabels(t: (key: string) => string): Record<StatsMetric, string> {
	return {
		conversations: t("dashboard.conversations"),
		messages: t("dashboard.messages"),
		tokens: t("dashboard.tokens"),
	}
}

function StatsSkeleton({ label }: { label: string }) {
	return (
		<div className="space-y-6">
			<output className="sr-only">{label}</output>
			<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
				<Skeleton className="h-9 w-44" />
				<Skeleton className="h-9 w-32" />
			</div>
			<div className="grid gap-4 sm:grid-cols-3">
				{Array.from({ length: 6 }, (_, index) => (
					<Card key={index}>
						<CardHeader>
							<Skeleton className="h-4 w-28 max-w-full" />
							<Skeleton className="mt-1 h-7 w-16" />
						</CardHeader>
					</Card>
				))}
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-5 w-40" />
				</CardHeader>
				<CardContent>
					<Skeleton className="h-64 w-full" />
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<Skeleton className="h-5 w-48" />
					<Skeleton className="h-4 w-80 max-w-full" />
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						{Array.from({ length: 5 }, (_, index) => (
							<Skeleton key={index} className="h-8 w-full" />
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

function DashboardFilters({
	agentLines,
	selectedIds,
	days,
	updatedAt,
	onSelectionChange,
	onRangeChange,
}: {
	agentLines: AgentLine[]
	selectedIds: string[]
	days: StatsDays
	updatedAt: string
	onSelectionChange: (ids: string[]) => void
	onRangeChange: (next: StatsDays) => void
}) {
	const { t } = useTranslation()
	const { language } = useLanguage()
	return (
		<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
			<AgentFilter agentLines={agentLines} selectedIds={selectedIds} onChange={onSelectionChange} />
			<RangeFilter days={days} onChange={onRangeChange} />
			<p className="text-muted-foreground ms-auto text-sm">
				{t("dashboard.lastUpdated")} <time dateTime={updatedAt}>{formatTime(updatedAt, language)}</time>
			</p>
		</div>
	)
}

function NoAgentsState({
	canCreate,
	pending,
	onCreate,
}: {
	canCreate: boolean
	pending: boolean
	onCreate: () => void
}) {
	const { t } = useTranslation()
	return (
		<EmptyState
			icon={Bot}
			title={t("dashboard.noAgentsTitle")}
			description={t("dashboard.noAgentsDescription")}
			actions={
				canCreate ? (
					<Button onClick={onCreate} disabled={pending}>
						<Plus className="size-4" />
						{pending ? t("agents.creating") : t("agents.create")}
					</Button>
				) : undefined
			}
		/>
	)
}

function RangeEmptyState({ days, onShowAllTime }: { days: StatsDays; onShowAllTime: () => void }) {
	const { t } = useTranslation()
	return (
		<EmptyState
			icon={ChartColumn}
			title={t("dashboard.emptyTitle")}
			description={
				days === "all"
					? t("dashboard.emptyAll")
					: t("dashboard.emptyRange", { range: t(STATS_RANGE_LABELS[`${days}`]) })
			}
			actions={
				days === "all" ? undefined : (
					<Button variant="outline" onClick={onShowAllTime}>
						{t("dashboard.rangeAll")}
					</Button>
				)
			}
		/>
	)
}

type BreakdownAgent = AgentLine & { conversations: number; messages: number; tokens: number }

function DashboardUsage({
	overview,
	stats,
	selectedIds,
	selectedLines,
	dailyPoints,
	breakdownAgents,
}: {
	overview: StatsOverview
	stats: PageStats
	selectedIds: string[]
	selectedLines: AgentLine[]
	dailyPoints: AgentDailyPoint[]
	breakdownAgents: BreakdownAgent[]
}) {
	const { t } = useTranslation()
	const compactNumber = useCompactNumber()
	const labels = useMemo(() => metricLabels(t), [t])
	const cardGroups = useMemo<{ primary: StatsCard[]; secondary: StatsCard[] }>(() => {
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

	return (
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
										<td className="py-2 text-right tabular-nums">{compactNumber.format(agent.conversations)}</td>
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
	)
}

export function DashboardIndexPage({
	search,
	onSearchChange,
	openAgent,
}: {
	search: DashboardSearch
	onSearchChange: (search: DashboardSearch) => void
	openAgent?: (agentId: string) => void
}) {
	const { t } = useTranslation()
	// The agent and range selections live in ?agents= and ?days= so a filtered view is
	// shareable; a missing param means every agent / the default range. Toggles replace the
	// URL entry and never move the scroll.
	const days = search.days ?? DEFAULT_STATS_DAYS
	const statsQuery = useGetStatsOverview(
		{ days },
		{ query: { refetchInterval: STATS_REFRESH_MS, retry: retryUnlessClientError } },
	)
	const agentsQuery = useListAgents({ query: { retry: retryUnlessClientError } })
	const canCreateAgent = useGetMyPermissions().data?.data.permissions.includes("admin") ?? false

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
	const { create, pending, failure } = useCreateAgentFlow({
		names: allAgents?.map((agent) => agent.name) ?? [],
		refreshNames: agentsQuery.refetch,
		onCreated: async (agentId) => {
			await agentsQuery.refetch()
			openAgent?.(agentId)
		},
	})
	const selection = search.agents
	const setSelection = (ids: string[]) => {
		onSearchChange({ ...search, agents: ids.length === allIds.length ? undefined : ids })
	}
	const setRange = (next: StatsDays) => {
		onSearchChange({ ...search, days: next === DEFAULT_STATS_DAYS ? undefined : next })
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

	const hasAgents = (allAgents?.length ?? 0) > 0
	const rangeIsEmpty =
		stats !== undefined && allSelected && stats.conversations === 0 && stats.messages === 0 && stats.tokens === 0

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
				<ProblemAlert
					error={error ?? agentsQuery.error}
					fallback={t("dashboard.loadFailed")}
					onRetry={() => {
						void statsQuery.refetch()
						void agentsQuery.refetch()
					}}
				/>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<PageHeader title={t("dashboard.heading")} description={t("dashboard.subheading")} />

			<ProviderNoticeBanner />

			<ProblemAlert message={failure?.message} onRetry={failure?.retryable ? () => void create() : undefined} />

			{isLoading || agentsQuery.isLoading || !overview || !stats ? (
				<StatsSkeleton label={t("dashboard.loading")} />
			) : !hasAgents ? (
				<NoAgentsState canCreate={canCreateAgent} pending={pending} onCreate={() => void create()} />
			) : (
				<>
					<DashboardFilters
						agentLines={agentLines}
						selectedIds={selectedIds}
						days={days}
						updatedAt={updatedAt}
						onSelectionChange={setSelection}
						onRangeChange={setRange}
					/>
					{selectedIds.length === 0 ? (
						<p className="text-muted-foreground">{t("dashboard.noAgentsSelected")}</p>
					) : rangeIsEmpty ? (
						<RangeEmptyState days={days} onShowAllTime={() => setRange("all")} />
					) : (
						<DashboardUsage
							overview={overview}
							stats={stats}
							selectedIds={selectedIds}
							selectedLines={selectedLines}
							dailyPoints={dailyPoints}
							breakdownAgents={breakdownAgents}
						/>
					)}
				</>
			)}
		</div>
	)
}
