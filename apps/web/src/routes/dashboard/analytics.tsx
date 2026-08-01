import { PageHeader } from "@/components/page-header"
import { useActiveWidget } from "@/features/widgets/widgets-query"
import { useLanguage } from "@/lib/use-language"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@talqo/ui/components/tabs"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { useWidgetStats, type WidgetStats } from "./-widget-stats-query"

export const Route = createFileRoute("/dashboard/analytics")({
	// Selected bot lives in the URL so the page is shareable; see
	// features/widgets/widgets-query.ts useActiveWidget.
	validateSearch: (search: Record<string, unknown>) => ({
		bot: typeof search.bot === "string" ? search.bot : undefined,
	}),
	component: AnalyticsPage,
})

const metricKeys = ["conversations", "messages", "tokens"] as const
const metricColors: Record<(typeof metricKeys)[number], string> = {
	conversations: "var(--chart-1)",
	messages: "var(--chart-2)",
	tokens: "var(--chart-3)",
}

function formatHistoryDate(language: string, date: string) {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString(language, {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	})
}

function MetricChart({
	history,
	metric,
	label,
	language,
	compactNumber,
}: {
	history: WidgetStats["history"]
	metric: (typeof metricKeys)[number]
	label: string
	language: string
	compactNumber: Intl.NumberFormat
}) {
	return (
		<ResponsiveContainer width="100%" height={280}>
			<AreaChart data={history} margin={{ top: 8, right: 8, left: 8 }}>
				<CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
				<XAxis
					dataKey="date"
					tickFormatter={(date: string) => formatHistoryDate(language, date)}
					tick={{ fontSize: 12 }}
					stroke="var(--muted-foreground)"
					tickLine={false}
					axisLine={false}
				/>
				<YAxis
					tickFormatter={(value: number) => compactNumber.format(value)}
					tick={{ fontSize: 12 }}
					stroke="var(--muted-foreground)"
					tickLine={false}
					axisLine={false}
					width={48}
				/>
				<Tooltip
					labelFormatter={(axisLabel) => formatHistoryDate(language, String(axisLabel))}
					contentStyle={{
						background: "var(--popover)",
						border: "1px solid var(--border)",
						borderRadius: "var(--radius)",
						color: "var(--popover-foreground)",
						fontSize: 12,
					}}
				/>
				<Area
					type="monotone"
					dataKey={metric}
					name={label}
					stroke={metricColors[metric]}
					fill={metricColors[metric]}
					fillOpacity={0.15}
					strokeWidth={2}
				/>
			</AreaChart>
		</ResponsiveContainer>
	)
}

function AnalyticsPage() {
	const { t } = useTranslation()
	const { widgets, isLoading, activeId, setSelectedId } = useActiveWidget()
	const { data: stats, isLoading: statsLoading } = useWidgetStats(activeId)
	const { language } = useLanguage()
	// Numbers and dates follow the operator's dashboard language, not a fixed locale.
	const compactNumber = useMemo(() => new Intl.NumberFormat(language, { notation: "compact" }), [language])

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<PageHeader
				title={t("analytics.heading")}
				description={t("analytics.subheading")}
				actions={
					<Select
						value={activeId}
						onValueChange={(value) => setSelectedId(value ?? "")}
						disabled={isLoading || !widgets?.length}
					>
						<SelectTrigger className="w-48" aria-label={t("analytics.selectWidget")}>
							<SelectValue placeholder={t("analytics.selectWidget")} />
						</SelectTrigger>
						<SelectContent>
							{(widgets ?? []).map((widget) => (
								<SelectItem key={widget.id} value={widget.id}>
									{widget.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				}
			/>

			{isLoading ? (
				<p className="text-muted-foreground">{t("analytics.loading")}</p>
			) : !widgets?.length ? (
				<p className="text-muted-foreground">{t("analytics.empty")}</p>
			) : statsLoading || !stats ? (
				<p className="text-muted-foreground">{t("analytics.loadingStats")}</p>
			) : (
				<>
					<div className="grid gap-4 sm:grid-cols-3">
						{metricKeys.map((metric) => (
							<Card key={metric}>
								<CardHeader>
									<CardDescription>{t("analytics.last30Days", { metric: t(`analytics.${metric}`) })}</CardDescription>
									<CardTitle className="text-2xl">{compactNumber.format(stats[metric])}</CardTitle>
								</CardHeader>
							</Card>
						))}
					</div>

					<Card>
						<CardHeader>
							<CardTitle>{t("analytics.usageOverTime")}</CardTitle>
							<CardDescription>{t("analytics.dailyTotals")}</CardDescription>
						</CardHeader>
						<CardContent>
							<Tabs defaultValue="conversations">
								<TabsList>
									{metricKeys.map((metric) => (
										<TabsTrigger key={metric} value={metric}>
											{t(`analytics.${metric}`)}
										</TabsTrigger>
									))}
								</TabsList>
								{metricKeys.map((metric) => (
									<TabsContent key={metric} value={metric}>
										<MetricChart
											history={stats.history}
											metric={metric}
											label={t(`analytics.${metric}`)}
											language={language}
											compactNumber={compactNumber}
										/>
									</TabsContent>
								))}
							</Tabs>
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}
