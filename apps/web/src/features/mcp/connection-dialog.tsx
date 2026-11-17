import type { McpServer } from "@/api/generated/models/mcpServer.zod"
import type { TFunction } from "i18next"

import { getListMcpServersQueryKey, useCreateMcpServer, useUpdateMcpServer } from "@/api/generated/mcp/mcp.ts"
import { FloatingActionButton } from "@/components/floating-action-button"
import { McpArgumentsEditor } from "@/features/mcp/components/mcp-arguments-editor"
import { McpEnvEditor } from "@/features/mcp/components/mcp-env-editor"
import {
	type ConnectionDraft,
	type DraftReason,
	EMPTY_DRAFT,
	invalidSecretRow,
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
function apiError(caught: unknown, t: TFunction): string {
	const code = (caught as { info?: { code?: string } }).info?.code
	switch (code ?? "") {
		case "invalid-request":
		case "malformed-json":
			return t("mcp.errorAddress")
		case "invalid-mcp-server-name":
			return t("mcp.errorNameLength", { limit: MCP_SERVER_NAME_LIMIT })
		case "duplicate-mcp-server-name":
			return t("mcp.errorDuplicateName")
		case "configuration-conflict":
			return t("mcp.errorConflict")
		case "mcp-stdio-disabled":
			return t("mcp.stdioDisabled")
		default:
			return t("mcp.errorSave")
	}
}

type DraftField = "name" | "url" | "command" | "headers" | "env"

type DraftError = {
	field?: DraftField
	focusId?: string
	message: string
	/** The secret row the operator has to fix, when `field` is a secret list. */
	rowId?: string
}

function draftFailure(
	reason: DraftReason,
	draft: ConnectionDraft,
	requireSecretValue: boolean,
	t: TFunction,
): DraftError {
	switch (reason) {
		case "nameRequired":
			return { field: "name", focusId: "mcp-name", message: t("mcp.errorName") }
		case "nameAscii":
			return { field: "name", focusId: "mcp-name", message: t("mcp.errorNameAscii") }
		case "nameTooLong":
			return { field: "name", focusId: "mcp-name", message: t("mcp.errorNameLength", { limit: MCP_SERVER_NAME_LIMIT }) }
		case "addressRequired":
			return { field: "url", focusId: "mcp-url", message: t("mcp.errorAddress") }
		case "commandRequired":
			return { field: "command", focusId: "mcp-command", message: t("mcp.errorCommand") }
		case "secretRequired": {
			const field = draft.transport === "http" ? "headers" : "env"
			const rows = draft.transport === "http" ? draft.headers : draft.env
			const row = invalidSecretRow(rows, requireSecretValue)
			return {
				field,
				focusId: row ? `mcp-${field}-${row.id}-${row.name.trim() ? "value" : "name"}` : undefined,
				rowId: row?.id,
				message: t("mcp.errorSecret"),
			}
		}
		default:
			return { message: t("mcp.errorSave") }
	}
}

function fieldErrorId(field: DraftField): string {
	return `mcp-${field}-error`
}

function focusField(failure: DraftError): void {
	if (failure.focusId) document.getElementById(failure.focusId)?.focus()
}

function FieldError({ field, message }: { field: DraftField; message: string }) {
	return (
		<p id={fieldErrorId(field)} role="alert" className="text-destructive text-xs">
			{message}
		</p>
	)
}

function RequiredMark() {
	return (
		<span aria-hidden="true" className="text-muted-foreground">
			*
		</span>
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
		args: server.args.map((value) => ({ id: crypto.randomUUID(), value })),
		headers: server.headers.map(({ name }) => ({ id: crypto.randomUUID(), name, value: "" })),
		env: server.env.map(({ name }) => ({ id: crypto.randomUUID(), name, value: "" })),
	}
}

function useConnectionSave(agentId: string, server: McpServer | undefined, t: TFunction, onSaved: () => void) {
	const queryClient = useQueryClient()
	const [error, setError] = useState<DraftError | null>(null)
	// Invalidate after save so later edits use new revision.
	const saved = async () => {
		onSaved()
		await queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey(agentId) })
	}
	const create = useCreateMcpServer({ mutation: { onSuccess: saved } })
	const update = useUpdateMcpServer({ mutation: { onSuccess: saved } })
	const pending = create.isPending || update.isPending
	const failed = (caught: unknown) => setError({ message: apiError(caught, t) })

	function refuseDraft(draft: ConnectionDraft, reason: DraftReason, creating: boolean): void {
		const failure = draftFailure(reason, draft, creating, t)
		setError(failure)
		focusField(failure)
	}

	function submit(draft: ConnectionDraft): void {
		setError(null)
		if (server) {
			const result = toEditBody(draft, server)
			if (!result.ok) return refuseDraft(draft, result.reason, false)
			void update.mutateAsync({ agentId, serverId: server.id, data: result.body }).catch(failed)
		} else {
			const result = toCreateBody(draft)
			if (!result.ok) return refuseDraft(draft, result.reason, true)
			void create.mutateAsync({ agentId, data: result.body }).catch(failed)
		}
	}

	return { error, setError, pending, createPending: create.isPending, submit }
}

function ConnectionTrigger({
	server,
	disabled,
	floating,
	createPending,
}: {
	server?: McpServer
	disabled: boolean
	floating: boolean
	createPending: boolean
}) {
	const { t } = useTranslation()
	return (
		<DialogTrigger
			render={
				server ? (
					<Button variant="ghost" size="icon-sm" aria-label={t("mcp.edit")} />
				) : floating ? (
					<FloatingActionButton disabled={disabled || createPending} />
				) : (
					<Button disabled={disabled || createPending} />
				)
			}
		>
			{server ? (
				<Pencil className="size-4" />
			) : (
				<>
					<Plus className="size-4" />
					{createPending ? t("mcp.adding") : t("mcp.add")}
				</>
			)}
		</DialogTrigger>
	)
}

function NameField({ value, error, onChange }: { value: string; error?: string; onChange: (name: string) => void }) {
	const { t } = useTranslation()
	return (
		<div className="space-y-2">
			<Label htmlFor="mcp-name">
				{t("mcp.name")} <RequiredMark />
			</Label>
			<Input
				id="mcp-name"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				autoComplete="off"
				required
				aria-invalid={error !== undefined}
				aria-describedby={error === undefined ? undefined : fieldErrorId("name")}
			/>
			{error !== undefined && <FieldError field="name" message={error} />}
		</div>
	)
}

function TransportField({
	value,
	stdioAllowed,
	editingStdio,
	onChange,
	onClearError,
}: {
	value: ConnectionDraft["transport"]
	stdioAllowed: boolean
	editingStdio: boolean
	onChange: (transport: ConnectionDraft["transport"]) => void
	onClearError: () => void
}) {
	const { t } = useTranslation()
	return (
		<div className="space-y-2">
			<Label htmlFor="mcp-transport">{t("mcp.kind")}</Label>
			<Select<ConnectionDraft["transport"]>
				value={value}
				items={{
					http: t("mcp.transportHttp"),
					stdio: t("mcp.transportStdio"),
				}}
				onValueChange={(next) => {
					if (next === null) return
					onClearError()
					onChange(next)
				}}
			>
				<SelectTrigger id="mcp-transport" className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="http">{t("mcp.transportHttp")}</SelectItem>
					{(stdioAllowed || editingStdio) && (
						<SelectItem value="stdio" disabled={!stdioAllowed}>
							{t("mcp.transportStdio")}
						</SelectItem>
					)}
				</SelectContent>
			</Select>
		</div>
	)
}

function HttpAuthFields({
	draft,
	error,
	onChange,
	onClearError,
}: {
	draft: ConnectionDraft
	error: DraftError | null
	onChange: (patch: Partial<ConnectionDraft>) => void
	onClearError: () => void
}) {
	const { t } = useTranslation()
	return (
		<>
			<div className="space-y-2">
				<Label htmlFor="mcp-auth">{t("mcp.authMethod")}</Label>
				<Select<ConnectionDraft["authMode"]>
					value={draft.authMode}
					items={{
						none: t("mcp.authNone"),
						headers: t("mcp.authHeaders"),
					}}
					onValueChange={(next) => {
						if (next === null) return
						onClearError()
						onChange({ authMode: next })
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
				<>
					<McpEnvEditor
						kind="headers"
						env={draft.headers}
						invalidRowId={error?.field === "headers" ? error.rowId : undefined}
						errorId={error?.field === "headers" ? fieldErrorId("headers") : undefined}
						onChange={(headers) => onChange({ headers })}
					/>
					{error?.field === "headers" && <FieldError field="headers" message={error.message} />}
				</>
			)}
		</>
	)
}

function HttpConnectionFields({
	draft,
	error,
	onChange,
	onClearError,
}: {
	draft: ConnectionDraft
	error: DraftError | null
	onChange: (patch: Partial<ConnectionDraft>) => void
	onClearError: () => void
}) {
	const { t } = useTranslation()
	return (
		<>
			<div className="space-y-2">
				<Label htmlFor="mcp-url">
					{t("mcp.address")} <RequiredMark />
				</Label>
				<Input
					id="mcp-url"
					value={draft.url}
					onChange={(event) => onChange({ url: event.target.value })}
					placeholder="https://example.com/mcp"
					autoComplete="off"
					required
					aria-invalid={error?.field === "url"}
					aria-describedby={error?.field === "url" ? fieldErrorId("url") : undefined}
				/>
				{error?.field === "url" && <FieldError field="url" message={error.message} />}
			</div>
			<HttpAuthFields draft={draft} error={error} onChange={onChange} onClearError={onClearError} />
		</>
	)
}

function StdioConnectionFields({
	draft,
	error,
	disabled,
	onChange,
}: {
	draft: ConnectionDraft
	error: DraftError | null
	disabled: boolean
	onChange: (patch: Partial<ConnectionDraft>) => void
}) {
	const { t } = useTranslation()
	return (
		<fieldset disabled={disabled} className="space-y-3">
			<div className="space-y-2">
				<Label htmlFor="mcp-command">
					{t("mcp.command")} <RequiredMark />
				</Label>
				<Input
					id="mcp-command"
					value={draft.command}
					onChange={(event) => onChange({ command: event.target.value })}
					placeholder="bunx"
					autoComplete="off"
					required
					aria-invalid={error?.field === "command"}
					aria-describedby={error?.field === "command" ? fieldErrorId("command") : undefined}
				/>
				{error?.field === "command" && <FieldError field="command" message={error.message} />}
			</div>
			<McpArgumentsEditor args={draft.args} onChange={(args) => onChange({ args })} />
			<McpEnvEditor
				env={draft.env}
				invalidRowId={error?.field === "env" ? error.rowId : undefined}
				errorId={error?.field === "env" ? fieldErrorId("env") : undefined}
				onChange={(env) => onChange({ env })}
			/>
			{error?.field === "env" && <FieldError field="env" message={error.message} />}
		</fieldset>
	)
}

function ConnectionFormFooter({
	actionLabel,
	pending,
	stdioBlocked,
	onClose,
}: {
	actionLabel: string
	pending: boolean
	stdioBlocked: boolean
	onClose: () => void
}) {
	const { t } = useTranslation()
	return (
		<DialogFooter>
			<Button type="button" variant="outline" onClick={onClose} disabled={pending}>
				{t("common.cancel")}
			</Button>
			<Button type="submit" disabled={pending || stdioBlocked}>
				{pending ? t("mcp.saving") : actionLabel}
			</Button>
		</DialogFooter>
	)
}

function ConnectionForm({
	server,
	stdioAllowed,
	draft,
	error,
	actionLabel,
	pending,
	onChange,
	onClearError,
	onSubmit,
	onClose,
}: {
	server?: McpServer
	stdioAllowed: boolean
	draft: ConnectionDraft
	error: DraftError | null
	actionLabel: string
	pending: boolean
	onChange: (patch: Partial<ConnectionDraft>) => void
	onClearError: () => void
	onSubmit: () => void
	onClose: () => void
}) {
	const { t } = useTranslation()
	const stdioBlocked = draft.transport === "stdio" && !stdioAllowed
	return (
		<form
			className="space-y-3"
			// Keep the native required semantics while our own messages drive validation.
			noValidate
			onSubmit={(event) => {
				event.preventDefault()
				onSubmit()
			}}
		>
			<p className="text-muted-foreground text-xs">{t("common.requiredHint")}</p>
			<NameField
				value={draft.name}
				error={error?.field === "name" ? error.message : undefined}
				onChange={(name) => onChange({ name })}
			/>
			<TransportField
				value={draft.transport}
				stdioAllowed={stdioAllowed}
				editingStdio={server?.transport === "stdio"}
				onChange={(transport) => onChange({ transport })}
				onClearError={onClearError}
			/>
			{draft.transport === "http" ? (
				<HttpConnectionFields draft={draft} error={error} onChange={onChange} onClearError={onClearError} />
			) : (
				<StdioConnectionFields draft={draft} error={error} disabled={stdioBlocked} onChange={onChange} />
			)}
			{stdioBlocked && <p className="text-muted-foreground text-sm">{t("mcp.stdioDisabled")}</p>}
			{error && !error.field && (
				<p role="alert" className="text-destructive text-xs">
					{error.message}
				</p>
			)}
			<ConnectionFormFooter actionLabel={actionLabel} pending={pending} stdioBlocked={stdioBlocked} onClose={onClose} />
		</form>
	)
}

export function ConnectionDialog({
	agentId,
	server,
	stdioAllowed,
	disabled = false,
	floating = false,
}: {
	agentId: string
	server?: McpServer
	stdioAllowed: boolean
	disabled?: boolean
	floating?: boolean
}) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [draft, setDraft] = useState<ConnectionDraft>(() => draftFor(server))
	const { error, setError, pending, createPending, submit } = useConnectionSave(agentId, server, t, () =>
		setOpen(false),
	)
	const actionLabel = server ? t("mcp.save") : t("mcp.add")
	const set = (patch: Partial<ConnectionDraft>) => setDraft((current) => ({ ...current, ...patch }))

	function openChanged(next: boolean) {
		if (pending) return
		// Every open starts from the stored server, so cancelled edits and entered secrets never return.
		if (next) setDraft(draftFor(server))
		setError(null)
		setOpen(next)
	}

	return (
		<Dialog open={open} onOpenChange={openChanged}>
			<ConnectionTrigger server={server} disabled={disabled} floating={floating} createPending={createPending} />
			<DialogContent closeLabel={t("common.close")} className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{server ? t("mcp.editTitle") : t("mcp.addTitle")}</DialogTitle>
					<DialogDescription>{server ? t("mcp.editDescription") : t("mcp.addDescription")}</DialogDescription>
				</DialogHeader>
				<ConnectionForm
					server={server}
					stdioAllowed={stdioAllowed}
					draft={draft}
					error={error}
					actionLabel={actionLabel}
					pending={pending}
					onChange={set}
					onClearError={() => setError(null)}
					onSubmit={() => submit(draft)}
					onClose={() => openChanged(false)}
				/>
			</DialogContent>
		</Dialog>
	)
}
