import type { McpServer } from "@/api/generated/models/mcpServer.zod"
import type { TFunction } from "i18next"

import {
	getListMcpServersQueryKey,
	useCreateMcpServer,
	useDeleteMcpServer,
	useListMcpServers,
	useProbeMcpServer,
	useSetMcpServerDisabled,
	useUpdateMcpServer,
} from "@/api/generated/mcp/mcp.ts"
import { Badge } from "@talqo/ui/components/badge"
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
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Switch } from "@talqo/ui/components/switch"
import { useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import {
	EMPTY_DRAFT,
	connectionSummary,
	toCreateBody,
	toUpdateBody,
	toggleTool,
	type ConnectionDraft,
	type DraftReason,
} from "./connection-body"

type Translate = TFunction

const NOT_FOUND_STATUS = 404

// Written as literal calls because the extractor only keeps keys it can see in a t() call.
function transportText(transport: McpServer["transport"], t: Translate): string {
	return transport === "http" ? t("mcp.transportHttp") : t("mcp.transportStdio")
}

function healthText(health: McpServer["health"], t: Translate): string {
	if (health === "healthy") return t("mcp.healthHealthy")
	return health === "unhealthy" ? t("mcp.healthUnhealthy") : t("mcp.healthUnconfigured")
}

function draftErrorText(reason: DraftReason, t: Translate): string {
	if (reason === "nameRequired") return t("mcp.errorName")
	if (reason === "addressRequired") return t("mcp.errorAddress")
	return reason === "commandRequired" ? t("mcp.errorCommand") : t("mcp.errorSecret")
}

export function McpConnectionsCard({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const invalidate = () => queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey(agentId) })
	const { data, isLoading, isError } = useListMcpServers(agentId)
	const create = useCreateMcpServer({ mutation: { onSuccess: invalidate } })
	const probe = useProbeMcpServer({ mutation: { onSuccess: invalidate } })
	const servers = data?.data.servers ?? []

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">{t("mcp.panelDescription")}</p>
				{canManage && <AddConnectionButton agentId={agentId} pending={create.isPending} />}
			</div>
			{create.isError && (
				<p role="alert" className="text-destructive text-sm">
					{t("mcp.createFailed")}
				</p>
			)}

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
						<ConnectionCard
							key={server.id}
							agentId={agentId}
							server={server}
							canManage={canManage}
							onChange={invalidate}
						/>
					))}
				</div>
			)}
			{probe.isError && (
				<p role="alert" className="text-destructive text-sm">
					{t("mcp.testFailed")}
				</p>
			)}
		</div>
	)
}

function ConnectionCard({
	agentId,
	canManage,
	onChange,
	server,
}: {
	agentId: string
	canManage: boolean
	onChange: () => Promise<void>
	server: McpServer
}) {
	const { t } = useTranslation()
	const probe = useProbeMcpServer({ mutation: { onSuccess: onChange } })
	const setDisabled = useSetMcpServerDisabled({ mutation: { onSuccess: onChange } })
	const update = useUpdateMcpServer({ mutation: { onSuccess: onChange } })
	const remove = useDeleteMcpServer({ mutation: { onSuccess: onChange } })
	const [error, setError] = useState<string | null>(null)
	const [expanded, setExpanded] = useState(false)
	const [confirmOpen, setConfirmOpen] = useState(false)
	const [confirmation, setConfirmation] = useState("")

	async function guard(action: () => Promise<unknown>) {
		setError(null)
		try {
			await action()
		} catch (caught) {
			setError((caught as { status?: number }).status === NOT_FOUND_STATUS ? t("mcp.notFound") : t("mcp.actionFailed"))
		}
	}

	return (
		<Card className="h-full">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{server.name}
					<Badge variant={server.isDisabled ? "secondary" : "outline"}>{transportText(server.transport, t)}</Badge>
					<Badge variant={server.health === "unhealthy" ? "destructive" : "secondary"}>
						{healthText(server.health, t)}
					</Badge>
				</CardTitle>
				<p className="text-muted-foreground truncate font-mono text-sm">{connectionSummary(server)}</p>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-muted-foreground text-xs">{t("mcp.toolsAvailable", { toolCount: server.toolCount })}</p>
				{/* A failed probe is a warning with a retry, never an error dialog. */}
				{server.health === "unhealthy" && (
					<p role="status" className="text-destructive text-xs">
						{server.healthDetail ?? t("mcp.unreachable")}
					</p>
				)}
				{server.tools.length > 0 && (
					<div>
						<Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
							{expanded ? t("mcp.hideTools") : t("mcp.showTools")}
						</Button>
						{expanded && (
							<fieldset className="mt-2 space-y-1">
								<legend className="sr-only">{t("mcp.toolsLegend")}</legend>
								{server.tools.map((tool) => (
									<label key={tool.name} className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={tool.selected}
											disabled={!canManage || update.isPending}
											onChange={(event) =>
												void guard(() =>
													update.mutateAsync({
														agentId,
														serverId: server.id,
														data: toUpdateBody(server, {
															tools: toggleTool(server.tools, tool.name, event.target.checked),
														}),
													}),
												)
											}
										/>
										<span className="truncate">{tool.name}</span>
									</label>
								))}
							</fieldset>
						)}
					</div>
				)}

				{canManage && (
					<fieldset disabled={setDisabled.isPending} className="flex flex-wrap items-center gap-3">
						<div className="flex items-center gap-2">
							<Switch
								checked={!server.isDisabled}
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
							<span className="text-muted-foreground text-sm">{t("mcp.enabled")}</span>
						</div>
						<Button
							variant="outline"
							size="sm"
							disabled={probe.isPending}
							onClick={() => void guard(() => probe.mutateAsync({ agentId, serverId: server.id }))}
						>
							{probe.isPending ? t("mcp.testing") : t("mcp.test")}
						</Button>
					</fieldset>
				)}
				{error && (
					<p role="alert" className="text-destructive text-xs">
						{error}
					</p>
				)}
				{canManage && (
					<Dialog
						open={confirmOpen}
						onOpenChange={(next) => {
							if (remove.isPending) return
							setConfirmOpen(next)
							if (!next) {
								setConfirmation("")
								setError(null)
							}
						}}
					>
						<Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
							<Trash2 className="size-4" />
							{t("mcp.remove")}
						</Button>
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
							<div className="space-y-2">
								<Label htmlFor={`mcp-delete-${server.id}`} className="flex items-center gap-2">
									<span className="sr-only">{t("mcp.confirmLabel", { name: server.name })}</span>
								</Label>
								<Input
									id={`mcp-delete-${server.id}`}
									value={confirmation}
									onChange={(event) => setConfirmation(event.target.value)}
									placeholder={server.name}
									autoComplete="off"
								/>
							</div>
							<DialogFooter>
								<Button variant="outline" onClick={() => setConfirmOpen(false)}>
									{t("common.cancel")}
								</Button>
								<Button
									variant="destructive"
									disabled={confirmation !== server.name || remove.isPending}
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
				)}
			</CardContent>
		</Card>
	)
}

function AddConnectionButton({ agentId, pending }: { agentId: string; pending: boolean }) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [draft, setDraft] = useState<ConnectionDraft>(EMPTY_DRAFT)
	const [reason, setReason] = useState<DraftReason | null>(null)
	const create = useCreateMcpServer({ mutation: { onSuccess: () => setOpen(false) } })
	const set = (patch: Partial<ConnectionDraft>) => setDraft((current) => ({ ...current, ...patch }))

	async function onSubmit() {
		const result = toCreateBody(draft)
		if (!result.ok) {
			setReason(result.reason)
			return
		}
		setReason(null)
		await create.mutateAsync({ agentId, data: result.body })
		setDraft(EMPTY_DRAFT)
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (create.isPending) return
				setOpen(next)
				if (!next) {
					setDraft(EMPTY_DRAFT)
					setReason(null)
				}
			}}
		>
			<Button disabled={pending} onClick={() => setOpen(true)}>
				<Plus className="size-4" />
				{t(pending ? "mcp.adding" : "mcp.add")}
			</Button>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("mcp.addTitle")}</DialogTitle>
					<DialogDescription>{t("mcp.addDescription")}</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault()
						void onSubmit()
					}}
				>
					<div className="space-y-2">
						<Label htmlFor="mcp-name">{t("mcp.name")}</Label>
						<Input
							id="mcp-name"
							value={draft.name}
							onChange={(event) => set({ name: event.target.value })}
							autoComplete="off"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="mcp-transport">{t("mcp.kind")}</Label>
						<Select
							value={draft.transport}
							onValueChange={(value) => set({ transport: value as ConnectionDraft["transport"] })}
						>
							<SelectTrigger id="mcp-transport">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="http">{t("mcp.transportHttp")}</SelectItem>
								<SelectItem value="stdio">{t("mcp.transportStdio")}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{draft.transport === "http" ? (
						<>
							<div className="space-y-2">
								<Label htmlFor="mcp-url">{t("mcp.address")}</Label>
								<Input
									id="mcp-url"
									value={draft.url}
									onChange={(event) => set({ url: event.target.value })}
									placeholder="https://example.com/mcp"
									autoComplete="off"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="mcp-auth">{t("mcp.signIn")}</Label>
								<Select
									value={draft.authMode}
									onValueChange={(value) => set({ authMode: value as ConnectionDraft["authMode"] })}
								>
									<SelectTrigger id="mcp-auth">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">{t("mcp.authNone")}</SelectItem>
										<SelectItem value="headers">{t("mcp.authHeaders")}</SelectItem>
										<SelectItem value="oauth">{t("mcp.authSignIn")}</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{draft.authMode === "headers" && (
								<div className="grid grid-cols-2 gap-2">
									<div className="space-y-2">
										<Label htmlFor="mcp-header-name">{t("mcp.headerName")}</Label>
										<Input
											id="mcp-header-name"
											value={draft.headerName}
											onChange={(event) => set({ headerName: event.target.value })}
											placeholder="Authorization"
											autoComplete="off"
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="mcp-header-value">{t("mcp.headerValue")}</Label>
										<Input
											id="mcp-header-value"
											type="password"
											value={draft.headerValue}
											onChange={(event) => set({ headerValue: event.target.value })}
											autoComplete="off"
										/>
									</div>
								</div>
							)}
						</>
					) : (
						<>
							<div className="space-y-2">
								<Label htmlFor="mcp-command">{t("mcp.command")}</Label>
								<Input
									id="mcp-command"
									value={draft.command}
									onChange={(event) => set({ command: event.target.value })}
									placeholder="npx"
									autoComplete="off"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="mcp-args">{t("mcp.arguments")}</Label>
								<textarea
									id="mcp-args"
									className="rounded-control min-h-20 w-full border bg-transparent p-2 font-mono text-sm"
									value={draft.args}
									onChange={(event) => set({ args: event.target.value })}
								/>
								<p className="text-muted-foreground text-xs">{t("mcp.argumentsHint")}</p>
							</div>
							<div className="grid grid-cols-2 gap-2">
								<div className="space-y-2">
									<Label htmlFor="mcp-env-name">{t("mcp.envName")}</Label>
									<Input
										id="mcp-env-name"
										value={draft.envName}
										onChange={(event) => set({ envName: event.target.value })}
										placeholder="API_KEY"
										autoComplete="off"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="mcp-env-value">{t("mcp.envValue")}</Label>
									<Input
										id="mcp-env-value"
										type="password"
										value={draft.envValue}
										onChange={(event) => set({ envValue: event.target.value })}
										autoComplete="off"
									/>
								</div>
							</div>
						</>
					)}
					{reason && (
						<p role="alert" className="text-destructive text-xs">
							{draftErrorText(reason as DraftReason, t)}
						</p>
					)}
					<DialogFooter>
						<Button variant="outline" onClick={() => setOpen(false)}>
							{t("common.cancel")}
						</Button>
						<Button type="submit" disabled={create.isPending}>
							{create.isPending ? t("mcp.saving") : t("mcp.add")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
