import type { McpServer } from "@/api/generated/models/mcpServer.zod"

import {
	type DeleteMcpServerMutationError,
	type UpdateMcpServerMutationError,
	getListMcpServersQueryKey,
	useCreateMcpServer,
	useDeleteMcpServer,
	useListMcpServers,
	useSetMcpServerDisabled,
	useUpdateMcpServer,
} from "@/api/generated/mcp/mcp.ts"
import { McpArgumentsEditor } from "@/features/mcp/components/mcp-arguments-editor"
import { McpEnvEditor } from "@/features/mcp/components/mcp-env-editor"
import {
	EMPTY_DRAFT,
	connectionSummary,
	toCreateBody,
	toEditBody,
	toUpdateBody,
	toggleTool,
	type ConnectionDraft,
	type DraftReason,
} from "@/features/mcp/connection-body"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Checkbox } from "@talqo/ui/components/checkbox"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@talqo/ui/components/dialog"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Switch } from "@talqo/ui/components/switch"
import { useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

const NOT_FOUND_STATUS = 404

/** Problem details carry a code; the catalog turns it into something an operator can act on. */
function apiError(caught: unknown, t: (key: string) => string): string {
	const code = (caught as { info?: { code?: string } }).info?.code
	return code === "invalid-request" || code === "malformed-json"
		? t("mcp.errorAddress")
		: code === "duplicate-mcp-server-name"
			? t("mcp.errorDuplicateName")
			: code === "configuration-conflict"
				? t("mcp.errorConflict")
				: t("mcp.errorSave")
}

function draftErrorText(reason: DraftReason, t: (key: string) => string): string {
	if (reason === "nameRequired") return t("mcp.errorName")
	if (reason === "addressRequired") return t("mcp.errorAddress")
	return reason === "commandRequired" ? t("mcp.errorCommand") : t("mcp.errorSecret")
}

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

function ConnectionCard({ agentId, canManage, server }: { agentId: string; canManage: boolean; server: McpServer }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const refresh = () => queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey(agentId) })
	const update = useUpdateMcpServer({ mutation: { onSuccess: refresh } })
	const setDisabled = useSetMcpServerDisabled({ mutation: { onSuccess: refresh } })
	const remove = useDeleteMcpServer({ mutation: { onSuccess: refresh } })
	const [error, setError] = useState<string | null>(null)
	const [expanded, setExpanded] = useState(false)
	const [confirmOpen, setConfirmOpen] = useState(false)
	const [confirmation, setConfirmation] = useState("")

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
		<Card className="h-full">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{/* Whether a connection works is whether it has tools, so a dot says it without a label. */}
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
								<Checkbox
									checked={tool.selected}
									disabled={!canManage || update.isPending}
									aria-label={tool.name}
									onCheckedChange={(checked) =>
										void guard(() =>
											update.mutateAsync({
												agentId,
												serverId: server.id,
												data: toUpdateBody(server, { tools: toggleTool(server.tools, tool.name, checked) }),
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
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2">
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
							<span className="text-muted-foreground text-sm">{t("mcp.enabled")}</span>
						</div>
						<div className="flex items-center gap-2">
							<ConnectionDialog agentId={agentId} server={server} />
							<Button variant="destructive" size="xs" onClick={() => setConfirmOpen(true)}>
								<Trash2 className="size-4" />
								{t("mcp.remove")}
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
						if (!next) {
							setConfirmation("")
							setError(null)
						}
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
			</CardContent>
		</Card>
	)
}

function draftFor(server?: McpServer): ConnectionDraft {
	if (!server) return EMPTY_DRAFT
	return {
		...EMPTY_DRAFT,
		name: server.name,
		transport: server.transport,
		url: server.url ?? "",
		authMode: server.authMode ?? "none",
		command: server.command ?? "",
		args: server.args,
		env: server.env.map(({ name }) => ({ name, value: "" })),
	}
}

function ConnectionDialog({ agentId, server }: { agentId: string; server?: McpServer }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const [open, setOpen] = useState(false)
	const [draft, setDraft] = useState<ConnectionDraft>(() => draftFor(server))
	const [error, setError] = useState<string | null>(null)
	// Without this the card keeps a stale revision, and the next edit or tool toggle is rejected as a conflict.
	const saved = async () => {
		setOpen(false)
		await queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey(agentId) })
	}
	const create = useCreateMcpServer({ mutation: { onSuccess: saved } })
	const update = useUpdateMcpServer({ mutation: { onSuccess: saved } })
	const pending = create.isPending || update.isPending
	const set = (patch: Partial<ConnectionDraft>) => setDraft((current) => ({ ...current, ...patch }))
	const failed = (caught: unknown) => setError(apiError(caught, t))

	function onSubmit() {
		setError(null)
		if (server) {
			const result = toEditBody(draft, server)
			if (!result.ok) {
				setError(draftErrorText(result.reason, t))
				return
			}
			void update.mutateAsync({ agentId, serverId: server.id, data: result.body }).catch(failed)
			return
		}
		const result = toCreateBody(draft)
		if (!result.ok) {
			setError(draftErrorText(result.reason, t))
			return
		}
		void create.mutateAsync({ agentId, data: result.body }).catch(failed)
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!pending) setOpen(next)
			}}
		>
			<DialogTrigger render={server ? <Button variant="outline" size="xs" /> : <Button disabled={create.isPending} />}>
				{server ? <Pencil className="size-4" /> : <Plus className="size-4" />}
				{server ? t("mcp.edit") : create.isPending ? t("mcp.adding") : t("mcp.add")}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{server ? t("mcp.editTitle") : t("mcp.addTitle")}</DialogTitle>
					<DialogDescription>{server ? t("mcp.editDescription") : t("mcp.addDescription")}</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault()
						onSubmit()
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
							<SelectTrigger id="mcp-transport" className="w-full">
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
									<SelectTrigger id="mcp-auth" className="w-full">
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
											placeholder={server ? t("mcp.secretUnchanged") : undefined}
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
									placeholder="bunx"
									autoComplete="off"
								/>
							</div>
							<McpArgumentsEditor draft={draft} onChange={setDraft} />
							<McpEnvEditor env={draft.env} onChange={(env) => set({ env })} />
						</>
					)}
					{error && (
						<p role="alert" className="text-destructive text-xs">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
							{t("common.cancel")}
						</Button>
						<Button type="submit" disabled={pending}>
							{pending ? t("mcp.saving") : server ? t("mcp.save") : t("mcp.add")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
