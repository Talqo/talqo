import type { GetAgentAccess200 } from "@/api/generated/models/roles/getAgentAccess200.zod"

import { getListAgentsQueryKey } from "@/api/generated/agent/agent"
import {
	getGetAgentAccessQueryKey,
	getGetAgentPermissionsQueryKey,
	useGetAgentAccess,
	useRemoveAgentAccess,
	useSetAgentAccess,
} from "@/api/generated/roles/roles"
import { ProblemAlert } from "@/components/problem-alert"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Checkbox } from "@talqo/ui/components/checkbox"
import { Label } from "@talqo/ui/components/label"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useBlocker } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

type Permission = GetAgentAccess200["roles"][number]["permissions"][number]

const PERMISSION_LABELS = {
	"stats:read": "agentAccess.statistics",
	"conversations:read": "agentAccess.conversations",
	"agents:read": "agentAccess.viewConfiguration",
	"agents:manage": "agentAccess.editConfiguration",
	"agents:delete": "agentAccess.deleteAgent",
} as const satisfies Record<Permission, string>

function expanded(permissions: readonly Permission[]): Permission[] {
	return (Object.keys(PERMISSION_LABELS) as Permission[]).filter(
		(permission) =>
			permissions.includes(permission) || (permission === "agents:read" && permissions.includes("agents:manage")),
	)
}

export function AgentAccessCard({ agentId, permissions }: { agentId: string; permissions: readonly Permission[] }) {
	const { t } = useTranslation()
	const query = useGetAgentAccess(agentId)
	const client = useQueryClient()
	const save = useSetAgentAccess({ mutation: { onSuccess: refresh } })
	const remove = useRemoveAgentAccess({ mutation: { onSuccess: refresh } })
	const addRoleButton = useRef<HTMLButtonElement>(null)
	const editor = useRef<HTMLFieldSetElement>(null)
	const focusEditor = useRef(false)
	const [selectedId, setSelectedId] = useState<string>()
	const [drafts, setDrafts] = useState<Record<string, Permission[]>>({})
	const [adding, setAdding] = useState(false)
	const [notice, setNotice] = useState<"saved" | "removed">()
	const roles = query.data?.data.roles ?? []
	const visible = roles.filter((role) => role.permissions.length > 0 || drafts[role.id] !== undefined)
	const selected = roles.find((role) => role.id === (selectedId ?? visible[0]?.id))
	const values = selected ? expanded(drafts[selected.id] ?? selected.permissions) : []
	const pending = save.isPending || remove.isPending
	const dirty = Object.keys(drafts).length > 0
	useBlocker({ shouldBlockFn: () => dirty && !window.confirm(t("roles.leavePrompt")), enableBeforeUnload: dirty })
	useEffect(() => {
		if (selected && focusEditor.current) {
			editor.current?.focus()
			focusEditor.current = false
		}
	}, [selected])
	useEffect(() => {
		if (notice === "removed" && !pending) addRoleButton.current?.focus()
	}, [notice, pending])

	function clearDraft(roleId: string) {
		setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== roleId)))
	}

	async function refresh(): Promise<void> {
		await Promise.all([
			client.invalidateQueries({ queryKey: getGetAgentAccessQueryKey(agentId) }),
			client.invalidateQueries({ queryKey: getGetAgentPermissionsQueryKey(agentId) }),
			client.invalidateQueries({ queryKey: getListAgentsQueryKey() }),
		])
	}

	function onSave(): void {
		if (!selected || values.length === 0) return
		save.mutate(
			{ agentId, roleId: selected.id, data: { permissions: values } },
			{
				onSuccess: () => {
					clearDraft(selected.id)
					setNotice("saved")
				},
			},
		)
	}

	function onRemove(): void {
		if (!selected || !window.confirm(t("agentAccess.removePrompt", { role: selected.name }))) return
		remove.mutate(
			{ agentId, roleId: selected.id },
			{
				onSuccess: () => {
					clearDraft(selected.id)
					setSelectedId(undefined)
					setNotice("removed")
				},
			},
		)
	}

	function toggle(permission: Permission) {
		if (!selected) return
		const next = values.includes(permission) ? values.filter((value) => value !== permission) : [...values, permission]
		if (next.includes("agents:manage") && !next.includes("agents:read")) next.push("agents:read")
		if (
			selected.permissions.length > 0 &&
			JSON.stringify(expanded(next)) === JSON.stringify(expanded(selected.permissions))
		)
			clearDraft(selected.id)
		else setDrafts((current) => ({ ...current, [selected.id]: next }))
		setNotice(undefined)
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("agentAccess.title")}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground text-sm">{t("agentAccess.admin")}</p>
				{query.isPending ? (
					<p role="status">{t("roles.loading")}</p>
				) : query.isError ? (
					<ProblemAlert error={query.error} onRetry={() => void query.refetch()} />
				) : (
					<>
						<div className="flex flex-wrap gap-2" role="group" aria-label={t("agentAccess.roles")}>
							{visible.map((role) => (
								<Button
									key={role.id}
									variant={selected?.id === role.id ? "default" : "outline"}
									aria-pressed={selected?.id === role.id}
									className="max-w-full"
									onClick={() => {
										setSelectedId(role.id)
										setNotice(undefined)
										save.reset()
										remove.reset()
									}}
									disabled={pending}
								>
									<span className="truncate" title={role.name}>
										{role.name}
									</span>
								</Button>
							))}
							<Button
								ref={addRoleButton}
								variant="outline"
								onClick={() => setAdding(!adding)}
								disabled={pending || visible.length === roles.length}
							>
								<Plus className="size-4" />
								{t("agentAccess.addRole")}
							</Button>
						</div>
						{roles.length === 0 && (
							<Link to="/dashboard/users/roles" className="text-primary underline">
								{t("roles.create")}
							</Link>
						)}
						{adding && (
							<div className="space-y-2">
								<Label htmlFor={`add-role-${agentId}`}>{t("agentAccess.chooseRole")}</Label>
								<select
									id={`add-role-${agentId}`}
									className="border-input bg-background w-full rounded-md border p-2"
									value=""
									disabled={pending}
									onChange={(event) => {
										const id = event.target.value
										if (id) {
											focusEditor.current = true
											setSelectedId(id)
											setDrafts((current) => ({ ...current, [id]: [] }))
											setAdding(false)
											setNotice(undefined)
											save.reset()
											remove.reset()
										}
									}}
								>
									<option value="">{t("agentAccess.chooseRole")}</option>
									{roles
										.filter((role) => !visible.some(({ id }) => id === role.id))
										.map((role) => (
											<option key={role.id} value={role.id}>
												{role.name}
											</option>
										))}
								</select>
							</div>
						)}
						{selected ? (
							<fieldset ref={editor} tabIndex={-1} className="space-y-3" disabled={pending}>
								<legend className="mb-3 max-w-full font-medium break-words">
									{t("agentAccess.permissionsFor", { role: selected.name })}
								</legend>
								{(Object.keys(PERMISSION_LABELS) as Permission[]).map((permission) => (
									<div key={permission} className="flex items-center gap-2">
										<Checkbox
											id={`access-${permission}`}
											checked={values.includes(permission)}
											disabled={
												pending ||
												!permissions.includes(permission) ||
												(permission === "agents:read" && values.includes("agents:manage"))
											}
											onCheckedChange={() => toggle(permission)}
										/>
										<Label htmlFor={`access-${permission}`}>{t(PERMISSION_LABELS[permission])}</Label>
									</div>
								))}
								{(save.error || remove.error) && <ProblemAlert error={save.error ?? remove.error} />}
								<div className="flex flex-wrap items-center gap-2">
									<Button onClick={onSave} disabled={pending || !drafts[selected.id] || values.length === 0}>
										{save.isPending ? t("roles.saving") : t("agentAccess.save")}
									</Button>
									{selected.permissions.length > 0 ? (
										<Button
											variant="destructive"
											disabled={pending || selected.permissions.some((permission) => !permissions.includes(permission))}
											onClick={onRemove}
										>
											{t("agentAccess.remove")}
										</Button>
									) : (
										<Button
											variant="outline"
											onClick={() => {
												clearDraft(selected.id)
												setSelectedId(undefined)
											}}
										>
											{t("agentConfig.cancel")}
										</Button>
									)}
								</div>
							</fieldset>
						) : (
							<p className="text-muted-foreground text-sm">{t("agentAccess.empty")}</p>
						)}
						{notice && (
							<p role="status" className="text-muted-foreground text-sm">
								{notice === "saved" ? t("agentAccess.saved") : t("agentAccess.removed")}
							</p>
						)}
					</>
				)}
			</CardContent>
		</Card>
	)
}
