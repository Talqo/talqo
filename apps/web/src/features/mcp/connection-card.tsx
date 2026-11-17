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

type ToolUpdateVariables = {
	serverId: string
	data: { tools?: { enabled: boolean; name: string }[] }
}

function toolsAfterUpdate(
	cached: ListMcpServersQueryResult,
	variables: ToolUpdateVariables,
): ListMcpServersQueryResult {
	const enabled = new Map((variables.data.tools ?? []).map((tool) => [tool.name, tool.enabled]))
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
}

function useConnectionActions(agentId: string, server: McpServer) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const refresh = () => queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey(agentId) })
	const [error, setError] = useState<string | null>(null)
	const update = useUpdateMcpServer<UpdateMcpServerMutationError, { previous: ListMcpServersQueryResult | undefined }>({
		mutation: {
			async onMutate(variables) {
				const queryKey = getListMcpServersQueryKey(agentId)
				await queryClient.cancelQueries({ queryKey })
				const previous = queryClient.getQueryData<ListMcpServersQueryResult>(queryKey)
				queryClient.setQueryData<ListMcpServersQueryResult>(queryKey, (cached) =>
					cached ? toolsAfterUpdate(cached, variables) : cached,
				)
				return { previous }
			},
			onError: (_error, _variables, context) => {
				if (context?.previous) queryClient.setQueryData(getListMcpServersQueryKey(agentId), context.previous)
			},
			onSettled: refresh,
		},
	})
	const setDisabled = useSetMcpServerDisabled({ mutation: { onSuccess: refresh } })

	async function run(action: () => Promise<unknown>) {
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

	return {
		error,
		updateTool: (name: string, enabled: boolean) =>
			void run(() => update.mutateAsync({ agentId, serverId: server.id, data: toggledBody(server, name, enabled) })),
		setEnabled: (enabled: boolean) =>
			void run(() => setDisabled.mutateAsync({ agentId, serverId: server.id, action: enabled ? "enable" : "disable" })),
		setDisabledPending: setDisabled.isPending,
	}
}

function ConnectionHeader({ server }: { server: McpServer }) {
	const { t } = useTranslation()
	return (
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
	)
}

function ConnectionHealthNotice({ server, deploymentBlocked }: { server: McpServer; deploymentBlocked: boolean }) {
	const { t } = useTranslation()
	if (deploymentBlocked) return <p className="text-muted-foreground text-xs">{t("mcp.stdioDisabled")}</p>
	if (server.isWorking) return null
	return (
		<p role="alert" className="text-destructive text-xs">
			{t("mcp.unreachable")}
		</p>
	)
}

function ConnectionTools({
	server,
	canManage,
	deploymentBlocked,
	onToggle,
}: {
	server: McpServer
	canManage: boolean
	deploymentBlocked: boolean
	onToggle: (name: string, enabled: boolean) => void
}) {
	const { t } = useTranslation()
	const [expanded, setExpanded] = useState(false)
	return (
		<>
			<div className="flex items-center justify-between gap-2">
				<p className="text-muted-foreground text-xs">{t("mcp.toolsAvailable", { toolCount: server.toolCount })}</p>
				{server.tools.length > 0 && (
					<Button variant="ghost" size="xs" onClick={() => setExpanded((value) => !value)}>
						{expanded ? t("mcp.hideTools") : t("mcp.showTools")}
					</Button>
				)}
			</div>
			<ConnectionHealthNotice server={server} deploymentBlocked={deploymentBlocked} />
			{expanded && (
				<fieldset className="space-y-1" disabled={deploymentBlocked}>
					<legend className="sr-only">{t("mcp.toolsLegend")}</legend>
					{server.tools.map((tool) => (
						<label key={tool.name} className="flex items-center gap-2 text-sm">
							<Switch
								checked={tool.enabled}
								disabled={!canManage}
								aria-label={tool.name}
								onCheckedChange={(checked) => onToggle(tool.name, checked)}
							/>
							<span className="truncate">{tool.name}</span>
						</label>
					))}
				</fieldset>
			)}
		</>
	)
}

function RemoveConnection({ agentId, server }: { agentId: string; server: McpServer }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const [confirmOpen, setConfirmOpen] = useState(false)
	const remove = useDeleteMcpServer({
		mutation: {
			onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey(agentId) }),
		},
	})

	async function removeServer(): Promise<void> {
		try {
			await remove.mutateAsync({ agentId, serverId: server.id })
			setConfirmOpen(false)
		} catch {
			// ConfirmDialog renders the mutation error; the card would duplicate it.
		}
	}

	return (
		<>
			<Button variant="destructive" size="icon-sm" onClick={() => setConfirmOpen(true)} aria-label={t("mcp.remove")}>
				<Trash2 className="size-4" />
			</Button>
			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={(next) => {
					setConfirmOpen(next)
					if (!next) remove.reset()
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
		</>
	)
}

function ConnectionManagement({
	agentId,
	server,
	stdioAllowed,
	deploymentBlocked,
	setEnabled,
	setDisabledPending,
}: {
	agentId: string
	server: McpServer
	stdioAllowed: boolean
	deploymentBlocked: boolean
	setEnabled: (enabled: boolean) => void
	setDisabledPending: boolean
}) {
	const { t } = useTranslation()
	return (
		<div className="flex items-center justify-between gap-2">
			<div className="flex items-center gap-2">
				<Switch
					checked={!server.isDisabled}
					disabled={setDisabledPending || deploymentBlocked}
					onCheckedChange={setEnabled}
					aria-label={t("mcp.enabledFor", { name: server.name })}
				/>
				<span className="text-muted-foreground text-sm">{t("mcp.enabled")}</span>
			</div>
			<div className="flex items-center gap-1">
				<ConnectionDialog key={server.id} agentId={agentId} server={server} stdioAllowed={stdioAllowed} />
				<RemoveConnection agentId={agentId} server={server} />
			</div>
		</div>
	)
}

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
	const deploymentBlocked = server.transport === "stdio" && !stdioAllowed
	const { error, updateTool, setEnabled, setDisabledPending } = useConnectionActions(agentId, server)

	return (
		<Card className="h-full" data-testid="mcp-server-card">
			<ConnectionHeader server={server} />
			<CardContent className="flex flex-1 flex-col">
				<div className="flex flex-1 flex-col gap-3">
					<ConnectionTools
						server={server}
						canManage={canManage}
						deploymentBlocked={deploymentBlocked}
						onToggle={updateTool}
					/>
					<div className="mt-auto space-y-3">
						{error && (
							<p role="alert" className="text-destructive text-xs">
								{error}
							</p>
						)}
						{canManage && (
							<ConnectionManagement
								agentId={agentId}
								server={server}
								stdioAllowed={stdioAllowed}
								deploymentBlocked={deploymentBlocked}
								setEnabled={setEnabled}
								setDisabledPending={setDisabledPending}
							/>
						)}
					</div>
				</div>
			</CardContent>
		</Card>
	)
}
