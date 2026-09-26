import { useGetStatsOverview } from "@/api/generated/stats/stats.ts"
import { PageHeader } from "@/components/page-header"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import {
	DailyStatsChart,
	StatsMetricCards,
	statsMetricKeys,
	useCompactNumber,
	type StatsMetric,
} from "@/features/statistics/components/stats-charts"
import { toPageStats } from "@/features/statistics/page-stats"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

const FORBIDDEN_STATUS = 403
const STATS_DAYS = 30

export const Route = createFileRoute("/dashboard/")({
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
	const { data, error, isLoading } = useGetStatsOverview({ days: STATS_DAYS })
	const overview = data?.data.overview
	const stats = overview ? toPageStats(overview) : undefined
	const labels = metricLabels(t)
	const compactNumber = useCompactNumber()

	if (error?.status === FORBIDDEN_STATUS) {
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

			{isLoading || !stats || !overview ? (
				<p className="text-muted-foreground">{t("dashboard.loading")}</p>
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
							<DailyStatsChart daily={stats.daily} labels={labels} />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{t("dashboard.perAgentTitle")}</CardTitle>
							<CardDescription>{t("dashboard.perAgentDescription")}</CardDescription>
						</CardHeader>
						<CardContent>
							{overview.agents.length === 0 ? (
								<p className="text-muted-foreground">{t("dashboard.empty")}</p>
							) : (
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
										{overview.agents.map((agent) => (
											<tr key={agent.agentId} className="border-b last:border-0">
												<td className="py-2 font-medium">{agent.agentName}</td>
												<td className="py-2 text-right tabular-nums">{compactNumber.format(agent.conversations)}</td>
												<td className="py-2 text-right tabular-nums">{compactNumber.format(agent.messages)}</td>
												<td className="py-2 text-right tabular-nums">
													{compactNumber.format(agent.inputTokens + agent.outputTokens)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}
