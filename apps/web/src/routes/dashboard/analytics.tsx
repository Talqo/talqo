import { useGetStatsOverview } from "@/api/generated/stats/stats.ts"
import { PageHeader } from "@/components/page-header"
import { useActiveAgent } from "@/features/agents/use-active-agent"
import { requirePermission } from "@/features/permissions/require-permission"
import { DailyStatsChart, StatsMetricCards, type StatsMetric } from "@/features/statistics/components/stats-charts"
import { toPageStats } from "@/features/statistics/page-stats"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

const STATS_DAYS = 30

export const Route = createFileRoute("/dashboard/analytics")({
	beforeLoad: requirePermission("agents:read"),
	validateSearch: (search: Record<string, unknown>) => ({
		agent: typeof search.agent === "string" ? search.agent : undefined,
	}),
	component: AnalyticsPage,
})

function metricLabels(t: (key: string) => string): Record<StatsMetric, string> {
	return {
		conversations: t("analytics.conversations"),
		messages: t("analytics.messages"),
		tokens: t("analytics.tokens"),
	}
}

function AnalyticsPage() {
	const { t } = useTranslation()
	const { agents, isLoading, activeId, setSelectedId } = useActiveAgent()
	const { data: statsData, isLoading: statsLoading } = useGetStatsOverview(
		{ days: STATS_DAYS, agentId: activeId || undefined },
		{ query: { enabled: Boolean(activeId) } },
	)
	const stats = statsData ? toPageStats(statsData.data.overview) : undefined
	const labels = metricLabels(t)

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<PageHeader
				title={t("analytics.heading")}
				description={t("analytics.subheading")}
				actions={
					<Select
						value={activeId}
						onValueChange={(value) => setSelectedId(value ?? "")}
						disabled={isLoading || !agents?.length}
					>
						<SelectTrigger className="w-48" aria-label={t("analytics.selectAgent")}>
							<SelectValue placeholder={t("analytics.selectAgent")} />
						</SelectTrigger>
						<SelectContent>
							{(agents ?? []).map((agent) => (
								<SelectItem key={agent.id} value={agent.id}>
									{agent.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				}
			/>

			{isLoading ? (
				<p className="text-muted-foreground">{t("analytics.loading")}</p>
			) : !agents?.length ? (
				<p className="text-muted-foreground">{t("analytics.empty")}</p>
			) : !stats || statsLoading ? (
				<p className="text-muted-foreground">{t("analytics.loadingStats")}</p>
			) : (
				<>
					<StatsMetricCards
						stats={stats}
						labels={labels}
						cardDescription={(metric) => t("analytics.last30Days", { metric })}
					/>

					<Card>
						<CardHeader>
							<CardTitle>{t("analytics.usageOverTime")}</CardTitle>
							<CardDescription>{t("analytics.dailyTotals")}</CardDescription>
						</CardHeader>
						<CardContent>
							<DailyStatsChart daily={stats.daily} labels={labels} />
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}
