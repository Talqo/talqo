import type { AgentDailyPoint, DailyStatsPoint, PageStats } from "@/features/statistics/page-stats"

import { useLanguage } from "@/lib/use-language"
import { Card, CardHeader, CardDescription, CardTitle } from "@talqo/ui/components/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@talqo/ui/components/tabs"
import { useMemo } from "react"
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

export const statsMetricKeys = ["conversations", "messages", "tokens"] as const
export type StatsMetric = (typeof statsMetricKeys)[number]
export type StatsMetricLabels = Record<StatsMetric, string>

// Per-agent line colors cycle through the chart palette; the aggregated "total" series
// stays a muted dashed reference line so it never visually swallows the agent lines.
const agentLineColors = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
] as const
const totalLineColor = "var(--muted-foreground)"

export function agentLineColor(index: number): string {
	return agentLineColors[index % agentLineColors.length] ?? "var(--chart-1)"
}

export type AgentLine = {
	color: string
	id: string
	name: string
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

export type StatsInsightCard = {
	format: "compact" | "decimal"
	label: string
	value: number
}

// Averages read best with one fraction digit, while counts round compactly like the volume cards.
export function StatsInsightCards({ cards }: { cards: StatsInsightCard[] }) {
	const { language } = useLanguage()
	const compact = useMemo(() => new Intl.NumberFormat(language, { notation: "compact" }), [language])
	const decimal = useMemo(() => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }), [language])
	return (
		<div className="grid gap-4 sm:grid-cols-3">
			{cards.map((card) => (
				<Card key={card.label}>
					<CardHeader>
						<CardDescription>{card.label}</CardDescription>
						<CardTitle className="text-2xl">
							{(card.format === "compact" ? compact : decimal).format(card.value)}
						</CardTitle>
					</CardHeader>
				</Card>
			))}
		</div>
	)
}

function MetricChart({
	daily,
	agentDaily,
	agentLines,
	metric,
	totalLabel,
	chartTitle,
	chartDescription,
	language,
	compactNumber,
}: {
	daily: DailyStatsPoint[]
	agentDaily: AgentDailyPoint[]
	agentLines: AgentLine[]
	metric: StatsMetric
	totalLabel: string
	chartTitle: string
	chartDescription: string
	language: string
	compactNumber: Intl.NumberFormat
}) {
	// One row per day: the aggregated "total" plus each selected agent, zero-filled so
	// the lines stay continuous across days without activity.
	const rows = useMemo(() => {
		const byAgent = new Map<string, Map<string, AgentDailyPoint>>()
		for (const point of agentDaily) {
			let byDate = byAgent.get(point.agentId)
			if (!byDate) {
				byDate = new Map()
				byAgent.set(point.agentId, byDate)
			}
			byDate.set(point.date, point)
		}
		return daily.map((day) => ({
			date: day.date,
			total: day[metric],
			...Object.fromEntries(agentLines.map((line) => [line.id, byAgent.get(line.id)?.get(day.date)?.[metric] ?? 0])),
		}))
	}, [daily, agentDaily, agentLines, metric])

	return (
		<ResponsiveContainer width="100%" height={280}>
			<ComposedChart data={rows} margin={{ top: 8, right: 8, left: 8 }} title={chartTitle} desc={chartDescription}>
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
					// The aggregated total always leads the tooltip, above the per-agent entries.
					itemSorter={(item) => (item.dataKey === "total" ? 0 : 1)}
					contentStyle={{
						background: "var(--popover)",
						border: "1px solid var(--border)",
						borderRadius: "var(--radius)",
						color: "var(--popover-foreground)",
						fontSize: 12,
					}}
				/>
				<Legend />
				<Line
					type="monotone"
					dataKey="total"
					name={totalLabel}
					stroke={totalLineColor}
					strokeWidth={1}
					strokeDasharray="4 4"
					dot={false}
				/>
				{agentLines.map((line) => (
					<Line
						key={line.id}
						type="monotone"
						dataKey={line.id}
						name={line.name}
						stroke={line.color}
						strokeWidth={2}
						dot={false}
					/>
				))}
			</ComposedChart>
		</ResponsiveContainer>
	)
}

export function DailyStatsChart({
	daily,
	agentDaily,
	agentLines,
	labels,
	totalLabel,
	chartTitle,
	chartDescription,
}: {
	daily: DailyStatsPoint[]
	agentDaily: AgentDailyPoint[]
	agentLines: AgentLine[]
	labels: StatsMetricLabels
	totalLabel: string
	chartTitle: (metricLabel: string) => string
	chartDescription: string
}) {
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
						agentDaily={agentDaily}
						agentLines={agentLines}
						metric={metric}
						totalLabel={totalLabel}
						chartTitle={chartTitle(labels[metric])}
						chartDescription={chartDescription}
						language={language}
						compactNumber={compactNumber}
					/>
				</TabsContent>
			))}
		</Tabs>
	)
}
