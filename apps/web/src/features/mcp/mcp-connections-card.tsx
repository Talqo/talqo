import { useListMcpServers } from "@/api/generated/mcp/mcp.ts"
import { ProblemAlert } from "@/components/problem-alert"
import { ConnectionCard } from "@/features/mcp/connection-card"
import { ConnectionDialog } from "@/features/mcp/connection-dialog"
import { Card, CardContent, CardHeader } from "@talqo/ui/components/card"
import { EmptyState } from "@talqo/ui/components/empty-state"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { Wrench } from "lucide-react"
import { useTranslation } from "react-i18next"

export function McpConnectionsCard({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const { data, isLoading, isError, error, refetch } = useListMcpServers(agentId)
	const servers = data?.data.servers ?? []
	const stdioAllowed = data?.data.stdioAllowed === true

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">{t("mcp.panelDescription")}</p>
				{/* Add waits for the list: it carries the allowed transports. */}
				{canManage && <ConnectionDialog agentId={agentId} stdioAllowed={stdioAllowed} disabled={!data} />}
			</div>

			{isLoading ? (
				<div className="grid gap-4 md:grid-cols-2">
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
				<ProblemAlert error={error} fallback={t("mcp.loadFailed")} onRetry={() => void refetch()} />
			) : !servers.length ? (
				<EmptyState
					icon={Wrench}
					title={t("mcp.emptyTitle")}
					description={canManage ? t("mcp.emptyDescriptionManager") : t("mcp.emptyDescriptionReader")}
					actions={canManage ? <ConnectionDialog agentId={agentId} stdioAllowed={stdioAllowed} /> : undefined}
				/>
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
