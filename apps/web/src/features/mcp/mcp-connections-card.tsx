import { useListMcpServers } from "@/api/generated/mcp/mcp.ts"
import { ConnectionCard } from "@/features/mcp/connection-card"
import { ConnectionDialog } from "@/features/mcp/connection-dialog"
import { Card, CardContent, CardHeader } from "@talqo/ui/components/card"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { useTranslation } from "react-i18next"

export function McpConnectionsCard({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const { data, isLoading, isError } = useListMcpServers(agentId)
	const servers = data?.data.servers ?? []
	const stdioAllowed = data?.data.stdioAllowed === true

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">{t("mcp.panelDescription")}</p>
				{canManage && data && <ConnectionDialog agentId={agentId} stdioAllowed={stdioAllowed} />}
			</div>

			{isLoading ? (
				<div className="grid gap-4 md:grid-cols-2" aria-busy="true">
					<output className="sr-only">{t("mcp.loading")}</output>
					{Array.from({ length: 2 }, (_, index) => (
						<Card key={index}>
							<CardHeader>
								<Skeleton className="h-5 w-36 max-w-full" />
								<Skeleton className="h-4 w-52 max-w-full" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-8 w-full" />
							</CardContent>
						</Card>
					))}
				</div>
			) : isError ? (
				<p role="alert" className="text-destructive">
					{t("mcp.loadFailed")}
				</p>
			) : !servers.length ? (
				<p className="text-muted-foreground">{t("mcp.none")}</p>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{servers.map((server) => (
						<ConnectionCard
							key={server.id}
							agentId={agentId}
							server={server}
							canManage={canManage}
							stdioAllowed={stdioAllowed}
						/>
					))}
				</div>
			)}
		</div>
	)
}
