import { useListMcpServers } from "@/api/generated/mcp/mcp.ts"
import { ConnectionCard } from "@/features/mcp/connection-card"
import { ConnectionDialog } from "@/features/mcp/connection-dialog"
import { useTranslation } from "react-i18next"

export function McpConnectionsCard({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const { data, isLoading, isError } = useListMcpServers(agentId)
	const servers = data?.data.servers ?? []

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">{t("mcp.panelDescription")}</p>
				{canManage && <ConnectionDialog agentId={agentId} />}
			</div>

			{isLoading ? (
				<p className="text-muted-foreground">{t("mcp.loading")}</p>
			) : isError ? (
				<p role="alert" className="text-destructive">
					{t("mcp.loadFailed")}
				</p>
			) : !servers.length ? (
				<p className="text-muted-foreground">{t("mcp.none")}</p>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{servers.map((server) => (
						<ConnectionCard key={server.id} agentId={agentId} server={server} canManage={canManage} />
					))}
				</div>
			)}
		</div>
	)
}
