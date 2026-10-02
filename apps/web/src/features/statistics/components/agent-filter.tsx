import { Button } from "@talqo/ui/components/button"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@talqo/ui/components/select"
import { useTranslation } from "react-i18next"

import type { AgentLine } from "./stats-charts"

// A compact multi-select keeps the filter to one line even with many agents; the popup
// stays open while items toggle, so several agents can be picked without reopening it.
export function AgentFilter({
	agentLines,
	selectedIds,
	onChange,
}: {
	agentLines: AgentLine[]
	selectedIds: string[]
	onChange: (ids: string[]) => void
}) {
	const { t } = useTranslation()
	return (
		<div className="flex items-center gap-2">
			<span className="text-muted-foreground text-sm font-medium">{t("dashboard.agentsLabel")}</span>
			<Select multiple value={selectedIds} onValueChange={(nextIds: string[]) => onChange(nextIds)}>
				<SelectTrigger size="sm" aria-label={t("dashboard.agentsLabel")} className="min-w-40">
					<SelectValue>
						{t("dashboard.agentsSelected", { selected: selectedIds.length, total: agentLines.length })}
					</SelectValue>
				</SelectTrigger>
				<SelectContent align="start" className="w-auto max-w-72 min-w-(--anchor-width)">
					<div className="bg-popover sticky top-0 z-10 flex gap-1 p-1">
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="flex-1"
							onClick={() => onChange(agentLines.map((line) => line.id))}
							disabled={selectedIds.length === agentLines.length}
						>
							{t("dashboard.selectAll")}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="flex-1"
							onClick={() => onChange([])}
							disabled={selectedIds.length === 0}
						>
							{t("dashboard.deselectAll")}
						</Button>
					</div>
					<SelectSeparator />
					{agentLines.map((line) => (
						<SelectItem key={line.id} value={line.id}>
							<span className="size-2 shrink-0 rounded-full" style={{ background: line.color }} />
							{line.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)
}
