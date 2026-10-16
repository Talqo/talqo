import { useListAgentFiles } from "@/api/generated/agent/agent"
import { useListEmbeds } from "@/api/generated/embed/embed"
import { useListMcpServers } from "@/api/generated/mcp/mcp"
import { FileText, Globe, type LucideIcon, Wrench } from "lucide-react"
import { useTranslation } from "react-i18next"

function Metric({
	icon: Icon,
	label,
	value,
	isError,
}: {
	icon: LucideIcon
	label: string
	value: number | undefined
	isError: boolean
}) {
	const { t } = useTranslation()
	return (
		<span className="text-muted-foreground flex items-center gap-1 text-xs">
			<Icon className="size-3.5" aria-hidden />
			{label}: {isError ? t("agents.metricUnavailable") : (value ?? "…")}
		</span>
	)
}

export function AgentCardSummary({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const files = useListAgentFiles(agentId, { query: { enabled: canManage } })
	const connections = useListMcpServers(agentId)
	const embeds = useListEmbeds({ agentId })
	const isError = (canManage && files.isError) || connections.isError || embeds.isError

	return (
		<div className="space-y-2 border-t pt-3">
			<div className="flex flex-wrap gap-x-4 gap-y-1">
				{canManage && (
					<Metric
						icon={FileText}
						label={t("agents.metricFiles")}
						value={files.data?.data.files.length}
						isError={files.isError}
					/>
				)}
				<Metric
					icon={Wrench}
					label={t("agents.metricConnections")}
					value={connections.data?.data.servers.length}
					isError={connections.isError}
				/>
				<Metric
					icon={Globe}
					label={t("agents.metricEnabledEmbeds")}
					value={embeds.data?.data.embeds.filter((embed) => !embed.isDisabled).length}
					isError={embeds.isError}
				/>
			</div>
			{isError && (
				<p className="text-destructive text-xs" role="alert">
					{t("agents.summaryLoadFailed")}
				</p>
			)}
		</div>
	)
}
