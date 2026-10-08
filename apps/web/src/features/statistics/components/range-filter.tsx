import { STATS_RANGE_PRESETS, type StatsDays } from "@/features/statistics/ranges"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { useTranslation } from "react-i18next"

import { usePreserveScrollOnOpen } from "./use-preserve-scroll-on-open"

const rangeLabels = {
	"7": "dashboard.range7d",
	"30": "dashboard.range30d",
	"183": "dashboard.range6m",
	"365": "dashboard.range1y",
	all: "dashboard.rangeAll",
} as const satisfies Record<`${StatsDays}`, string>

export function RangeFilter({ days, onChange }: { days: StatsDays; onChange: (days: StatsDays) => void }) {
	const { t } = useTranslation()
	const { capturePreOpenScroll, onOpenChange } = usePreserveScrollOnOpen()
	return (
		<div className="flex items-center gap-2">
			<span className="text-muted-foreground text-sm font-medium">{t("dashboard.rangeLabel")}</span>
			<Select
				value={`${days}`}
				onValueChange={(next) => {
					if (next !== null) onChange(next === "all" ? "all" : (Number(next) as StatsDays))
				}}
				onOpenChange={onOpenChange}
			>
				<SelectTrigger
					size="sm"
					aria-label={t("dashboard.rangeLabel")}
					className="min-w-28"
					onPointerDownCapture={capturePreOpenScroll}
					onKeyDownCapture={capturePreOpenScroll}
				>
					<SelectValue>{t(rangeLabels[`${days}`])}</SelectValue>
				</SelectTrigger>
				<SelectContent align="start">
					{STATS_RANGE_PRESETS.map((preset) => (
						<SelectItem key={`${preset}`} value={`${preset}`}>
							{t(rangeLabels[`${preset}`])}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)
}
