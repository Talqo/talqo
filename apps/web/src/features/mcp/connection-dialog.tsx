import type { McpServer } from "@/api/generated/models/mcpServer.zod"

import { getListMcpServersQueryKey, useCreateMcpServer, useUpdateMcpServer } from "@/api/generated/mcp/mcp.ts"
import { McpArgumentsEditor } from "@/features/mcp/components/mcp-arguments-editor"
import { McpEnvEditor } from "@/features/mcp/components/mcp-env-editor"
import {
	type ConnectionDraft,
	type DraftReason,
	EMPTY_DRAFT,
	MCP_SERVER_NAME_LIMIT,
	toCreateBody,
	toEditBody,
} from "@/features/mcp/connection-body"
import { Button } from "@talqo/ui/components/button"
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
import { useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

/** Problem details carry a code; the catalog turns it into something an operator can act on. */
function apiError(caught: unknown, t: (key: string, options?: Record<string, number>) => string): string {
	const code = (caught as { info?: { code?: string } }).info?.code
	return code === "invalid-request" || code === "malformed-json"
		? t("mcp.errorAddress")
		: code === "invalid-mcp-server-name"
			? t("mcp.errorNameLength", { limit: MCP_SERVER_NAME_LIMIT })
			: code === "duplicate-mcp-server-name"
				? t("mcp.errorDuplicateName")
				: code === "configuration-conflict"
					? t("mcp.errorConflict")
					: code === "mcp-stdio-disabled"
						? t("mcp.stdioDisabled")
						: t("mcp.errorSave")
}

function draftErrorText(reason: DraftReason, t: (key: string, options?: Record<string, number>) => string): string {
	if (reason === "nameRequired") return t("mcp.errorName")
	if (reason === "nameAscii") return t("mcp.errorNameAscii")
	if (reason === "nameTooLong") return t("mcp.errorNameLength", { limit: MCP_SERVER_NAME_LIMIT })
	if (reason === "addressRequired") return t("mcp.errorAddress")
	return reason === "commandRequired" ? t("mcp.errorCommand") : t("mcp.errorSecret")
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
		args: server.args.map((value) => ({ id: crypto.randomUUID(), value })),
		headers: server.headers.map(({ name }) => ({ id: crypto.randomUUID(), name, value: "" })),
		env: server.env.map(({ name }) => ({ id: crypto.randomUUID(), name, value: "" })),
	}
}

export function ConnectionDialog({
	agentId,
	server,
	stdioAllowed,
}: {
	agentId: string
	server?: McpServer
	stdioAllowed: boolean
}) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const [open, setOpen] = useState(false)
	const [draft, setDraft] = useState<ConnectionDraft>(() => draftFor(server))
	const [error, setError] = useState<string | null>(null)
	// Invalidate after save so later edits use new revision.
	const saved = async () => {
		setOpen(false)
		await queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey(agentId) })
	}
	const create = useCreateMcpServer({ mutation: { onSuccess: saved } })
	const update = useUpdateMcpServer({ mutation: { onSuccess: saved } })
	const pending = create.isPending || update.isPending
	const stdioBlocked = draft.transport === "stdio" && !stdioAllowed
	const set = (patch: Partial<ConnectionDraft>) => setDraft((current) => ({ ...current, ...patch }))
	const failed = (caught: unknown) => setError(apiError(caught, t))

	function onSubmit() {
		setError(null)
		if (stdioBlocked) {
			setError(t("mcp.stdioDisabled"))
			return
		}
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
			<DialogTrigger
				render={
					server ? (
						<Button variant="ghost" size="icon-sm" aria-label={t("mcp.edit")} />
					) : (
						<Button disabled={create.isPending} />
					)
				}
			>
				{server ? (
					<Pencil className="size-4" />
				) : (
					<>
						<Plus className="size-4" />
						{create.isPending ? t("mcp.adding") : t("mcp.add")}
					</>
				)}
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
						<Select<ConnectionDraft["transport"]>
							value={draft.transport}
							onValueChange={(value) => {
								if (value === null) return
								set({ transport: value })
							}}
						>
							<SelectTrigger id="mcp-transport" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="http">{t("mcp.transportHttp")}</SelectItem>
								{(stdioAllowed || server?.transport === "stdio") && (
									<SelectItem value="stdio" disabled={!stdioAllowed}>
										{t("mcp.transportStdio")}
									</SelectItem>
								)}
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
								<Label htmlFor="mcp-auth">{t("mcp.authMethod")}</Label>
								<Select<ConnectionDraft["authMode"]>
									value={draft.authMode}
									items={{
										none: t("mcp.authNone"),
										headers: t("mcp.authHeaders"),
									}}
									onValueChange={(value) => {
										if (value === null) return
										set({ authMode: value })
									}}
								>
									<SelectTrigger id="mcp-auth" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">{t("mcp.authNone")}</SelectItem>
										<SelectItem value="headers">{t("mcp.authHeaders")}</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{draft.authMode === "headers" && (
								<McpEnvEditor kind="headers" env={draft.headers} onChange={(headers) => set({ headers })} />
							)}
						</>
					) : (
						<fieldset disabled={stdioBlocked} className="space-y-3">
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
							<McpArgumentsEditor args={draft.args} onChange={(args) => set({ args })} />
							<McpEnvEditor env={draft.env} onChange={(env) => set({ env })} />
						</fieldset>
					)}
					{stdioBlocked && <p className="text-muted-foreground text-sm">{t("mcp.stdioDisabled")}</p>}
					{error && (
						<p role="alert" className="text-destructive text-xs">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
							{t("common.cancel")}
						</Button>
						<Button type="submit" disabled={pending || stdioBlocked}>
							{pending ? t("mcp.saving") : server ? t("mcp.save") : t("mcp.add")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
