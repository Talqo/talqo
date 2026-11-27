import type { ListRoleAgents200 } from "@/api/generated/models/roles/listRoleAgents200.zod"
import type { ReactNode, RefObject } from "react"

import { getListAgentsQueryKey } from "@/api/generated/agent/agent"
import {
	getListRoleAgentsQueryKey,
	getListRolesQueryKey,
	useListRoleAgents,
	useRemoveRoleAgentAccess,
	useSetRoleAgentAccess,
} from "@/api/generated/roles/roles"
import { ProblemAlert } from "@/components/problem-alert"
import { clearAgentContent } from "@/features/permissions/clear-agent-content"
import { getProblemMessage } from "@/lib/problem-message"
import { retryUnlessClientError } from "@/lib/query-retry"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
import { FormActions } from "@talqo/ui/components/form-actions"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@talqo/ui/components/select"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { Switch } from "@talqo/ui/components/switch"
import { useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

const FORBIDDEN_STATUS = 403
const NOT_FOUND_STATUS = 404

type Agent = ListRoleAgents200["agents"][number]
type AgentPermission = Agent["permissions"][number]
type Notice = "saved" | "removed"

const AGENT_PERMISSION_LABELS = {
	"stats:read": "agentAccess.statistics",
	"conversations:read": "agentAccess.conversations",
	"agents:read": "agentAccess.viewConfiguration",
	"agents:manage": "agentAccess.editConfiguration",
	"agents:delete": "agentAccess.deleteAgent",
} as const satisfies Record<AgentPermission, string>

const AGENT_PERMISSION_DESCRIPTIONS = {
	"stats:read": "agentAccess.descriptions.statistics",
	"conversations:read": "agentAccess.descriptions.conversations",
	"agents:read": "agentAccess.descriptions.viewConfiguration",
	"agents:manage": "agentAccess.descriptions.editConfiguration",
	"agents:delete": "agentAccess.descriptions.deleteAgent",
} as const satisfies Record<AgentPermission, string>

function expandAgentPermissions(permissions: ReadonlyArray<AgentPermission>): Array<AgentPermission> {
	return (Object.keys(AGENT_PERMISSION_LABELS) as Array<AgentPermission>).filter(
		(permission) =>
			permissions.includes(permission) ||
			(permission === "agents:read" &&
				(permissions.includes("agents:manage") || permissions.includes("agents:delete"))),
	)
}

function useRoleAgentAccess(roleId: string) {
	const query = useListRoleAgents(roleId, { query: { retry: retryUnlessClientError } })
	const client = useQueryClient()
	const save = useSetRoleAgentAccess({ mutation: { onSuccess: refresh, onError: refreshAfterAccessError } })
	const remove = useRemoveRoleAgentAccess({ mutation: { onSuccess: refresh, onError: refreshAfterAccessError } })
	const agents = query.data?.data.agents ?? []
	const pending = save.isPending || remove.isPending

	async function refresh(): Promise<void> {
		const before = new Map(agents.map(({ id, permissions }) => [id, permissions]))
		await Promise.all([
			client.invalidateQueries({ queryKey: getListRoleAgentsQueryKey(roleId) }),
			client.invalidateQueries({ queryKey: getListAgentsQueryKey() }),
			client.invalidateQueries({ queryKey: getListRolesQueryKey() }),
		])
		const next = client.getQueryData<{ data: ListRoleAgents200 }>(getListRoleAgentsQueryKey(roleId))?.data.agents ?? []
		const lost = [...before].some(([id, permissions]) => {
			const current = next.find((agent) => agent.id === id)
			return !current || !permissions.every((permission) => current.permissions.includes(permission))
		})
		if (lost) clearAgentContent(client)
	}

	async function refreshAfterAccessError(error: { status: number }): Promise<void> {
		if (error.status === FORBIDDEN_STATUS || error.status === NOT_FOUND_STATUS) await refresh()
	}

	return { agents, pending, query, remove, save }
}

function useAccessDrafts(agents: ReadonlyArray<Agent>, onDirtyChange: (dirty: boolean) => void) {
	const [selectedId, setSelectedId] = useState<string>()
	const [drafts, setDrafts] = useState<Record<string, Array<AgentPermission>>>({})
	const [notice, setNotice] = useState<Notice>()
	const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
	const visible = agents.filter((agent) => agent.rolePermissions.length > 0 || drafts[agent.id] !== undefined)
	const selected = visible.find((agent) => agent.id === selectedId) ?? visible[0]
	const values = selected ? expandAgentPermissions(drafts[selected.id] ?? selected.rolePermissions) : []
	const dirty = agents.some(({ id }) => drafts[id] !== undefined)
	useEffect(() => {
		onDirtyChange(dirty)
	}, [dirty, onDirtyChange])
	useEffect(() => () => onDirtyChange(false), [onDirtyChange])

	function clearDraft(agentId: string) {
		setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== agentId)))
	}

	function toggle(permission: AgentPermission) {
		if (!selected) return
		const next = values.includes(permission) ? values.filter((value) => value !== permission) : [...values, permission]
		if ((next.includes("agents:manage") || next.includes("agents:delete")) && !next.includes("agents:read"))
			next.push("agents:read")
		if (
			selected.rolePermissions.length > 0 &&
			JSON.stringify(expandAgentPermissions(next)) === JSON.stringify(expandAgentPermissions(selected.rolePermissions))
		)
			clearDraft(selected.id)
		else setDrafts((current) => ({ ...current, [selected.id]: next }))
		setNotice(undefined)
	}

	return {
		clearDraft,
		confirmRemoveOpen,
		drafts,
		notice,
		selected,
		setConfirmRemoveOpen,
		setDrafts,
		setNotice,
		setSelectedId,
		toggle,
		values,
		visible,
	}
}

function useAccessFocus(notice: Notice | undefined, pending: boolean) {
	const addAgentButton = useRef<HTMLButtonElement>(null)
	const editor = useRef<HTMLFieldSetElement>(null)
	const focusEditor = useRef(false)
	useEffect(() => {
		if (notice === "removed" && !pending) addAgentButton.current?.focus()
	}, [notice, pending])
	function setEditorFocus(value: boolean) {
		focusEditor.current = value
	}
	return { addAgentButton, editor, focusEditor, setEditorFocus }
}

function AgentPicker({
	addAgentButton,
	agents,
	editor,
	focus,
	onAdd,
	onSelect,
	pending,
	selectedAgentId,
	visible,
}: {
	addAgentButton: RefObject<HTMLButtonElement | null>
	agents: ReadonlyArray<Agent>
	editor: RefObject<HTMLFieldSetElement | null>
	focus: { editor: RefObject<boolean>; set: (value: boolean) => void }
	onAdd: (id: string) => void
	onSelect: (id: string) => void
	pending: boolean
	selectedAgentId: string | undefined
	visible: ReadonlyArray<Agent>
}) {
	const { t } = useTranslation()
	return (
		<fieldset className="flex flex-wrap gap-2" disabled={pending}>
			<legend className="sr-only">{t("agentAccess.agents")}</legend>
			{visible.map((agent) => (
				<Button
					key={agent.id}
					variant={selectedAgentId === agent.id ? "default" : "outline"}
					aria-pressed={selectedAgentId === agent.id}
					className="max-w-full"
					onClick={() => onSelect(agent.id)}
					disabled={pending}
				>
					<span className="truncate" title={agent.name}>
						{agent.name}
					</span>
				</Button>
			))}
			<Select<string>
				value={null}
				onOpenChange={(open) => {
					if (open) focus.set(false)
				}}
				onValueChange={(id) => {
					if (id === null) return
					onAdd(id)
				}}
			>
				<SelectTrigger
					ref={addAgentButton}
					aria-label={t("agentAccess.addAgent")}
					disabled={pending || visible.length === agents.length}
					render={<Button variant="outline" />}
					className="[&>svg:last-child]:hidden"
				>
					<Plus className="size-4" />
					<span>{t("agentAccess.addAgent")}</span>
				</SelectTrigger>
				<SelectContent
					align="start"
					className="w-max max-w-[calc(100vw-2rem)]"
					finalFocus={() => (focus.editor.current ? editor.current : addAgentButton.current)}
				>
					{agents
						.filter((agent) => !visible.some(({ id }) => id === agent.id))
						.map((agent) => (
							<SelectItem key={agent.id} value={agent.id}>
								<span className="truncate" title={agent.name}>
									{agent.name}
								</span>
							</SelectItem>
						))}
				</SelectContent>
			</Select>
		</fieldset>
	)
}

function AgentPermissionRow({
	agent,
	locked,
	onToggle,
	permission,
	roleId,
	values,
}: {
	agent: Agent
	locked: boolean
	onToggle: (permission: AgentPermission) => void
	permission: AgentPermission
	roleId: string
	values: ReadonlyArray<AgentPermission>
}) {
	const { t } = useTranslation()
	const id = `access-${roleId}-${agent.id}-${permission}`
	const included =
		permission === "agents:read" && (values.includes("agents:manage") || values.includes("agents:delete"))
	const notHeld = !agent.permissions.includes(permission)
	const hint = included
		? t("roles.includedWith", {
				permission: values.includes("agents:manage")
					? t("agentAccess.editConfiguration")
					: t("agentAccess.deleteAgent"),
			})
		: notHeld
			? t("roles.notYours")
			: null
	return (
		<div className="flex items-start justify-between gap-6 py-4">
			<div className="space-y-1">
				<Label htmlFor={id}>{t(AGENT_PERMISSION_LABELS[permission])}</Label>
				<p id={`${id}-description`} className="text-muted-foreground text-sm">
					{t(AGENT_PERMISSION_DESCRIPTIONS[permission])}
					{hint ? <span className="block">{hint}</span> : null}
				</p>
			</div>
			<Switch
				render={<button type="button" aria-label={t(AGENT_PERMISSION_LABELS[permission])} />}
				nativeButton
				id={id}
				className="mt-0.5"
				checked={values.includes(permission)}
				disabled={locked || notHeld || included}
				aria-describedby={`${id}-description`}
				onCheckedChange={() => onToggle(permission)}
			/>
		</div>
	)
}

type EditorState = {
	agent: Agent
	canSave: boolean
	confirmRemoveOpen: boolean
	notice: Notice | undefined
	pending: boolean
	removeError: unknown
	roleId: string
	saveError: unknown
	savePending: boolean
	values: ReadonlyArray<AgentPermission>
}

type EditorActions = {
	clearDraft: (agentId: string) => void
	onRemove: () => void
	onSave: () => void
	onToggle: (permission: AgentPermission) => void
	removeReset: () => void
	selectAgent: (id: string | undefined) => void
	setConfirmRemoveOpen: (open: boolean) => void
}

function AgentAccessEditor({
	actions,
	editor,
	state,
}: {
	actions: EditorActions
	editor: RefObject<HTMLFieldSetElement | null>
	state: EditorState
}) {
	const { t } = useTranslation()
	const { agent, canSave, confirmRemoveOpen, notice, pending, removeError, roleId, saveError, savePending, values } =
		state
	return (
		<fieldset ref={editor} tabIndex={-1} className="space-y-3" disabled={pending}>
			<legend className="sr-only">{t("agentAccess.permissionsFor", { agent: agent.name })}</legend>
			<div className="divide-y">
				{(Object.keys(AGENT_PERMISSION_LABELS) as Array<AgentPermission>).map((permission) => (
					<AgentPermissionRow
						key={permission}
						agent={agent}
						locked={pending}
						onToggle={actions.onToggle}
						permission={permission}
						roleId={roleId}
						values={values}
					/>
				))}
			</div>
			{saveError ? <ProblemAlert error={saveError} /> : null}
			{agent.rolePermissions.length > 0 && values.length === 0 && (
				<output className="text-muted-foreground block text-sm">{t("agentAccess.useRemove")}</output>
			)}
			<div className="flex flex-wrap items-center justify-between gap-3 pt-2">
				{agent.rolePermissions.length > 0 ? (
					<Button
						variant="destructive"
						disabled={pending || agent.rolePermissions.some((permission) => !agent.permissions.includes(permission))}
						onClick={() => {
							actions.removeReset()
							actions.setConfirmRemoveOpen(true)
						}}
					>
						{t("agentAccess.remove")}
					</Button>
				) : null}
				<FormActions
					discard={
						agent.rolePermissions.length === 0 ? (
							<Button
								variant="outline"
								onClick={() => {
									actions.clearDraft(agent.id)
									actions.selectAgent(undefined)
								}}
							>
								{t("agentConfig.cancel")}
							</Button>
						) : undefined
					}
					status={notice === "saved" ? t("agentAccess.saved") : undefined}
				>
					<Button onClick={actions.onSave} disabled={pending || !canSave || values.length === 0}>
						{savePending ? t("roles.saving") : t("agentAccess.save")}
					</Button>
				</FormActions>
			</div>
			<ConfirmDialog
				open={confirmRemoveOpen}
				onOpenChange={(open) => {
					actions.setConfirmRemoveOpen(open)
					if (!open) actions.removeReset()
				}}
				title={t("agentAccess.remove")}
				description={t("agentAccess.removePrompt", { agent: agent.name })}
				cancelLabel={t("agentConfig.cancel")}
				confirmLabel={t("agentAccess.remove")}
				pendingLabel={t("roles.deleting")}
				pending={pending}
				error={removeError ? getProblemMessage(removeError, t, t("auth.errorFallback")) : undefined}
				onConfirm={actions.onRemove}
			/>
		</fieldset>
	)
}

export function RoleAccessCard({ onDirtyChange, roleId }: { onDirtyChange: (dirty: boolean) => void; roleId: string }) {
	const { t } = useTranslation()
	const { agents, pending, query, remove, save } = useRoleAgentAccess(roleId)
	const {
		clearDraft,
		confirmRemoveOpen,
		drafts,
		notice,
		selected,
		setConfirmRemoveOpen,
		setDrafts,
		setNotice,
		setSelectedId,
		toggle,
		values,
		visible,
	} = useAccessDrafts(agents, onDirtyChange)
	const { addAgentButton, editor, focusEditor, setEditorFocus } = useAccessFocus(notice, pending)

	function selectAgent(agentId: string | undefined) {
		setSelectedId(agentId)
		setNotice(undefined)
		save.reset()
		remove.reset()
	}

	function addAgent(agentId: string) {
		setEditorFocus(true)
		selectAgent(agentId)
		setDrafts((current) => ({ ...current, [agentId]: [] }))
	}

	function onSave(): void {
		if (!selected || values.length === 0) return
		remove.reset()
		setNotice(undefined)
		save.mutate(
			{ roleId, agentId: selected.id, data: { permissions: values } },
			{
				onSuccess: () => {
					clearDraft(selected.id)
					setNotice("saved")
				},
			},
		)
	}

	function onRemove(): void {
		if (!selected) return
		save.reset()
		setNotice(undefined)
		remove.mutate(
			{ roleId, agentId: selected.id },
			{
				onSuccess: () => {
					setConfirmRemoveOpen(false)
					clearDraft(selected.id)
					setSelectedId(undefined)
					setNotice("removed")
				},
			},
		)
	}

	let content: ReactNode
	if (query.isPending) {
		content = (
			<div className="flex flex-wrap gap-2">
				<output className="sr-only">{t("agentAccess.loading")}</output>
				{Array.from({ length: 3 }, (_, index) => (
					<Skeleton key={index} className="h-control w-28" />
				))}
			</div>
		)
	} else if (query.isError) {
		content = <ProblemAlert error={query.error} onRetry={() => void query.refetch()} />
	} else {
		let body: ReactNode
		if (agents.length === 0) body = <p className="text-muted-foreground text-sm">{t("agentAccess.noAgents")}</p>
		else if (selected)
			body = (
				<AgentAccessEditor
					actions={{
						clearDraft,
						onRemove,
						onSave,
						onToggle: toggle,
						removeReset: remove.reset,
						selectAgent,
						setConfirmRemoveOpen,
					}}
					editor={editor}
					state={{
						agent: selected,
						canSave: drafts[selected.id] !== undefined,
						confirmRemoveOpen,
						notice,
						pending,
						removeError: remove.error,
						roleId,
						saveError: save.error,
						savePending: save.isPending,
						values,
					}}
				/>
			)
		else body = <p className="text-muted-foreground text-sm">{t("agentAccess.empty")}</p>
		content = (
			<>
				{agents.length > 0 && (
					<AgentPicker
						addAgentButton={addAgentButton}
						agents={agents}
						editor={editor}
						focus={{ editor: focusEditor, set: setEditorFocus }}
						onAdd={addAgent}
						onSelect={selectAgent}
						pending={pending}
						selectedAgentId={selected?.id}
						visible={visible}
					/>
				)}
				{body}
				{notice === "removed" && (
					<output className="text-muted-foreground block text-sm">{t("agentAccess.removed")}</output>
				)}
			</>
		)
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("agentAccess.title")}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">{content}</div>
			</CardContent>
		</Card>
	)
}
