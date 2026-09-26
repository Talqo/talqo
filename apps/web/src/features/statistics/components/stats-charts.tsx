import type { DailyStatsPoint, PageStats } from "@/features/statistics/page-stats"

import { useLanguage } from "@/lib/use-language"
import { Card, CardHeader, CardDescription, CardTitle } from "@talqo/ui/components/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@talqo/ui/components/tabs"
import { useMemo } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

export const statsMetricKeys = ["conversations", "messages", "tokens"] as const
export type StatsMetric = (typeof statsMetricKeys)[number]
export type StatsMetricLabels = Record<StatsMetric, string>

const metricColors: Record<StatsMetric, string> = {
	conversations: "var(--chart-1)",
	messages: "var(--chart-2)",
	tokens: "var(--chart-3)",
}

const DATE_FORMAT_UTC = "T00:00:00Z"

export function useCompactNumber(): Intl.NumberFormat {
	const { language } = useLanguage()
	return useMemo(() => new Intl.NumberFormat(language, { notation: "compact" }), [language])
}

function formatHistoryDate(language: string, date: string) {
	return new Date(`${date}${DATE_FORMAT_UTC}`).toLocaleDateString(language, {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	})
}

export function StatsMetricCards({
	stats,
	labels,
	cardDescription,
}: {
	stats: PageStats
	labels: StatsMetricLabels
	cardDescription: (metricLabel: string) => string
}) {
	const compactNumber = useCompactNumber()
	return (
		<div className="grid gap-4 sm:grid-cols-3">
			{statsMetricKeys.map((metric) => (
				<Card key={metric}>
					<CardHeader>
						<CardDescription>{cardDescription(labels[metric])}</CardDescription>
						<CardTitle className="text-2xl">{compactNumber.format(stats[metric])}</CardTitle>
					</CardHeader>
				</Card>
			))}
		</div>
	)
}

function MetricChart({
	daily,
	metric,
	label,
	language,
	compactNumber,
}: {
	daily: DailyStatsPoint[]
	metric: StatsMetric
	label: string
	language: string
	compactNumber: Intl.NumberFormat
}) {
	return (
		<ResponsiveContainer width="100%" height={280}>
			<AreaChart data={daily} margin={{ top: 8, right: 8, left: 8 }}>
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

export function DailyStatsChart({ daily, labels }: { daily: DailyStatsPoint[]; labels: StatsMetricLabels }) {
	const { language } = useLanguage()
	const compactNumber = useCompactNumber()
	return (
		<Tabs defaultValue="conversations">
			<TabsList>
				{statsMetricKeys.map((metric) => (
					<TabsTrigger key={metric} value={metric}>
						{labels[metric]}
					</TabsTrigger>
				))}
			</TabsList>
			{statsMetricKeys.map((metric) => (
				<TabsContent key={metric} value={metric}>
					<MetricChart
						daily={daily}
						metric={metric}
						label={labels[metric]}
						language={language}
						compactNumber={compactNumber}
					/>
				</TabsContent>
			))}
		</Tabs>
	)
}
