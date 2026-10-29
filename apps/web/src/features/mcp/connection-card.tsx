import type { McpServer } from "@/api/generated/models/mcpServer.zod"

import {
	getListMcpServersQueryKey,
	type ListMcpServersQueryResult,
	type UpdateMcpServerMutationError,
	useDeleteMcpServer,
	useSetMcpServerDisabled,
	useUpdateMcpServer,
} from "@/api/generated/mcp/mcp.ts"
import { connectionSummary, toggledBody } from "@/features/mcp/connection-body"
import { ConnectionDialog } from "@/features/mcp/connection-dialog"
import { getProblemMessage } from "@/lib/problem-message"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader } from "@talqo/ui/components/card"
import { CardName } from "@talqo/ui/components/card-name"
import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
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
	stdioAllowed,
}: {
	agentId: string
	canManage: boolean
	server: McpServer
	stdioAllowed: boolean
}) {
	const { t } = useTranslation()
	const deploymentBlocked = server.transport === "stdio" && !stdioAllowed
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
				(caught as UpdateMcpServerMutationError).status === NOT_FOUND_STATUS
					? t("mcp.notFound")
					: t("mcp.actionFailed"),
			)
		}
	}

	async function removeServer(): Promise<void> {
		try {
			await remove.mutateAsync({ agentId, serverId: server.id })
			setConfirmOpen(false)
		} catch {
			// ConfirmDialog renders the mutation error; guard() would duplicate it in the card.
		}
	}

	return (
		<Card className="h-full" data-testid="mcp-server-card">
			<CardHeader>
				<CardName>{server.name}</CardName>
				<CardDescription className="min-w-0">
					<div className="space-y-1">
						<span className="block truncate font-mono" title={connectionSummary(server)}>
							{connectionSummary(server)}
						</span>
						<span className="flex items-center gap-1.5">
							<span
								aria-hidden="true"
								className={`size-2 shrink-0 rounded-full ${server.isWorking ? "bg-success" : "bg-destructive"}`}
							/>
							{server.isWorking ? t("mcp.statusConnected") : t("mcp.statusUnreachable")}
						</span>
					</div>
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-1 flex-col">
				<div className="flex flex-1 flex-col gap-3">
					<div className="flex items-center justify-between gap-2">
						<p className="text-muted-foreground text-xs">{t("mcp.toolsAvailable", { toolCount: server.toolCount })}</p>
						{server.tools.length > 0 && (
							<Button variant="ghost" size="xs" onClick={() => setExpanded((value) => !value)}>
								{expanded ? t("mcp.hideTools") : t("mcp.showTools")}
							</Button>
						)}
					</div>
					{deploymentBlocked ? (
						<p className="text-muted-foreground text-xs">{t("mcp.stdioDisabled")}</p>
					) : (
						!server.isWorking && (
							<p role="alert" className="text-destructive text-xs">
								{t("mcp.unreachable")}
							</p>
						)
					)}
					{expanded && (
						<fieldset className="space-y-1" disabled={deploymentBlocked}>
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

					<div className="mt-auto space-y-3">
						{error && (
							<p role="alert" className="text-destructive text-xs">
								{error}
							</p>
						)}
						{canManage && (
							<div className="flex items-center justify-between gap-2">
								<Switch
									checked={!server.isDisabled}
									disabled={setDisabled.isPending || deploymentBlocked}
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
									<ConnectionDialog key={server.id} agentId={agentId} server={server} stdioAllowed={stdioAllowed} />
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
					</div>

					<ConfirmDialog
						open={confirmOpen}
						onOpenChange={(next) => {
							setConfirmOpen(next)
							if (!next) {
								setError(null)
								remove.reset()
							}
						}}
						title={t("mcp.removeTitle")}
						description={t("mcp.removePrompt", { name: server.name })}
						cancelLabel={t("common.cancel")}
						confirmLabel={t("mcp.removeConfirm")}
						pendingLabel={t("mcp.removing")}
						pending={remove.isPending}
						error={remove.error ? getProblemMessage(remove.error, t, t("mcp.actionFailed")) : undefined}
						onConfirm={() => void removeServer()}
					/>
				</div>
			</CardContent>
		</Card>
	)
}
