import type { McpServer } from "@/api/generated/models/mcpServer.zod"

import {
	type DeleteMcpServerMutationError,
	type ListMcpServersQueryResult,
	type UpdateMcpServerMutationError,
	getListMcpServersQueryKey,
	useDeleteMcpServer,
	useSetMcpServerDisabled,
	useUpdateMcpServer,
} from "@/api/generated/mcp/mcp.ts"
import { connectionSummary, toggledBody } from "@/features/mcp/connection-body"
import { ConnectionDialog } from "@/features/mcp/connection-dialog"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@talqo/ui/components/card"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@talqo/ui/components/dialog"
import { Switch } from "@talqo/ui/components/switch"
import { useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

const NOT_FOUND_STATUS = 404

export function ConnectionCard({
	agentId,
	canManage,
	server,
}: {
	agentId: string
	canManage: boolean
	server: McpServer
}) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const refresh = () => queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey(agentId) })
	const update = useUpdateMcpServer<UpdateMcpServerMutationError, { previous: ListMcpServersQueryResult | undefined }>({
		mutation: {
			async onMutate(variables) {
				const queryKey = getListMcpServersQueryKey(agentId)
				await queryClient.cancelQueries({ queryKey })
				const previous = queryClient.getQueryData<ListMcpServersQueryResult>(queryKey)
				const enabled = new Map((variables.data.tools ?? []).map((tool) => [tool.name, tool.enabled]))
				queryClient.setQueryData<ListMcpServersQueryResult>(queryKey, (cached) => {
					if (!cached) return cached
					return {
						...cached,
						data: {
							...cached.data,
							servers: cached.data.servers.map((cachedServer) =>
								cachedServer.id !== variables.serverId
									? cachedServer
									: {
											...cachedServer,
											tools: cachedServer.tools.map((tool) => ({
												...tool,
												enabled: enabled.get(tool.name) ?? tool.enabled,
											})),
										},
							),
						},
					}
				})
				return { previous }
			},
			onError: (_error, _variables, context) => {
				if (context?.previous) queryClient.setQueryData(getListMcpServersQueryKey(agentId), context.previous)
			},
			onSettled: refresh,
		},
	})
	const setDisabled = useSetMcpServerDisabled({ mutation: { onSuccess: refresh } })
	const remove = useDeleteMcpServer({ mutation: { onSuccess: refresh } })
	const [error, setError] = useState<string | null>(null)
	const [expanded, setExpanded] = useState(false)
	const [confirmOpen, setConfirmOpen] = useState(false)

	async function guard(action: () => Promise<unknown>) {
		setError(null)
		try {
			await action()
		} catch (caught) {
			setError(
				(caught as UpdateMcpServerMutationError | DeleteMcpServerMutationError).status === NOT_FOUND_STATUS
					? t("mcp.notFound")
					: t("mcp.actionFailed"),
			)
		}
	}

	return (
		<Card className="h-full" data-testid="mcp-server-card">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{/* Green dot means last save found tools. */}
					<span
						aria-hidden="true"
						className={`size-2 shrink-0 rounded-full ${server.isWorking ? "bg-green-500" : "bg-destructive"}`}
					/>
					<span className="truncate">{server.name}</span>
				</CardTitle>
				<p className="text-muted-foreground truncate font-mono text-sm">{connectionSummary(server)}</p>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex items-center justify-between gap-2">
					<p className="text-muted-foreground text-xs">{t("mcp.toolsAvailable", { toolCount: server.toolCount })}</p>
					{server.tools.length > 0 && (
						<Button variant="ghost" size="xs" onClick={() => setExpanded((value) => !value)}>
							{expanded ? t("mcp.hideTools") : t("mcp.showTools")}
						</Button>
					)}
				</div>
				{!server.isWorking && (
					<p role="alert" className="text-destructive text-xs">
						{t("mcp.unreachable")}
					</p>
				)}
				{expanded && (
					<fieldset className="space-y-1">
						<legend className="sr-only">{t("mcp.toolsLegend")}</legend>
						{server.tools.map((tool) => (
							<label key={tool.name} className="flex items-center gap-2 text-sm">
								<Switch
									checked={tool.enabled}
									disabled={!canManage}
									aria-label={tool.name}
									onCheckedChange={(checked) =>
										void guard(() =>
											update.mutateAsync({
												agentId,
												serverId: server.id,
												data: toggledBody(server, tool.name, checked),
											}),
										)
									}
								/>
								<span className="truncate">{tool.name}</span>
							</label>
						))}
					</fieldset>
				)}

				{canManage && (
					<div className="flex items-center justify-between gap-2">
						<Switch
							checked={!server.isDisabled}
							disabled={setDisabled.isPending}
							onCheckedChange={(checked) =>
								void guard(() =>
									setDisabled.mutateAsync({
										agentId,
										serverId: server.id,
										action: checked ? "enable" : "disable",
									}),
								)
							}
							aria-label={t("mcp.enabled")}
						/>
						<div className="flex items-center gap-1">
							<ConnectionDialog key={server.id} agentId={agentId} server={server} />
							<Button
								variant="destructive"
								size="icon-sm"
								onClick={() => setConfirmOpen(true)}
								aria-label={t("mcp.remove")}
							>
								<Trash2 className="size-4" />
							</Button>
						</div>
					</div>
				)}
				{error && (
					<p role="alert" className="text-destructive text-xs">
						{error}
					</p>
				)}

				<Dialog
					open={confirmOpen}
					onOpenChange={(next) => {
						if (remove.isPending) return
						setConfirmOpen(next)
						if (!next) setError(null)
					}}
				>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t("mcp.removeTitle")}</DialogTitle>
							<DialogDescription>{t("mcp.removePrompt", { name: server.name })}</DialogDescription>
						</DialogHeader>
						{error && (
							<p role="alert" className="text-destructive text-sm">
								{error}
							</p>
						)}
						<DialogFooter>
							<Button variant="outline" onClick={() => setConfirmOpen(false)}>
								{t("common.cancel")}
							</Button>
							<Button
								variant="destructive"
								disabled={remove.isPending}
								onClick={() =>
									void guard(async () => {
										await remove.mutateAsync({ agentId, serverId: server.id })
										setConfirmOpen(false)
									})
								}
							>
								{remove.isPending ? t("mcp.removing") : t("mcp.removeConfirm")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</CardContent>
		</Card>
	)
}
