import type { GetAgentAccess200 } from "@/api/generated/models/roles/getAgentAccess200.zod"

import { getListAgentsQueryKey } from "@/api/generated/agent/agent"
import {
	getGetAgentAccessQueryKey,
	getGetMyPermissionsQueryKey,
	useGetAgentAccess,
	useRemoveAgentAccess,
	useSetAgentAccess,
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
import { Link } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

type Permission = GetAgentAccess200["permissions"][number]
const FORBIDDEN_STATUS = 403
const NOT_FOUND_STATUS = 404

const PERMISSION_LABELS = {
	"stats:read": "agentAccess.statistics",
	"conversations:read": "agentAccess.conversations",
	"agents:read": "agentAccess.viewConfiguration",
	"agents:manage": "agentAccess.editConfiguration",
	"agents:delete": "agentAccess.deleteAgent",
} as const satisfies Record<Permission, string>

const PERMISSION_DESCRIPTIONS = {
	"stats:read": "agentAccess.descriptions.statistics",
	"conversations:read": "agentAccess.descriptions.conversations",
	"agents:read": "agentAccess.descriptions.viewConfiguration",
	"agents:manage": "agentAccess.descriptions.editConfiguration",
	"agents:delete": "agentAccess.descriptions.deleteAgent",
} as const satisfies Record<Permission, string>

function expanded(permissions: readonly Permission[]): Permission[] {
	return (Object.keys(PERMISSION_LABELS) as Permission[]).filter(
		(permission) =>
			permissions.includes(permission) ||
			(permission === "agents:read" &&
				(permissions.includes("agents:manage") || permissions.includes("agents:delete"))),
	)
}

export function AgentAccessCard({
	agentId,
	onDirtyChange,
	permissions,
}: {
	agentId: string
	onDirtyChange?: (dirty: boolean) => void
	permissions: readonly Permission[]
}) {
	const { t } = useTranslation()
	const query = useGetAgentAccess(agentId, { query: { retry: retryUnlessClientError } })
	const client = useQueryClient()
	const save = useSetAgentAccess({ mutation: { onSuccess: refresh, onError: refreshAfterAccessError } })
	const remove = useRemoveAgentAccess({ mutation: { onSuccess: refresh, onError: refreshAfterAccessError } })
	const addRoleButton = useRef<HTMLButtonElement>(null)
	const editor = useRef<HTMLFieldSetElement>(null)
	const focusEditor = useRef(false)
	const [selectedId, setSelectedId] = useState<string>()
	const [drafts, setDrafts] = useState<Record<string, Permission[]>>({})
	const [notice, setNotice] = useState<"saved" | "removed">()
	const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
	const roles = query.data?.data.roles ?? []
	const visible = roles.filter((role) => role.permissions.length > 0 || drafts[role.id] !== undefined)
	const selected = visible.find((role) => role.id === selectedId) ?? visible[0]
	const values = selected ? expanded(drafts[selected.id] ?? selected.permissions) : []
	const pending = save.isPending || remove.isPending
	const dirty = roles.some(({ id }) => drafts[id] !== undefined)
	useEffect(() => {
		onDirtyChange?.(dirty)
		return () => onDirtyChange?.(false)
	}, [dirty, onDirtyChange])
	useEffect(() => {
		if (notice === "removed" && !pending) addRoleButton.current?.focus()
	}, [notice, pending])

	function clearDraft(roleId: string) {
		setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== roleId)))
	}

	async function refresh(): Promise<void> {
		await Promise.all([
			client.invalidateQueries({ queryKey: getGetAgentAccessQueryKey(agentId) }),
			client.invalidateQueries({ queryKey: getListAgentsQueryKey() }),
			client.invalidateQueries({ queryKey: getGetMyPermissionsQueryKey() }),
		])
		const access = client.getQueryData<{ data: GetAgentAccess200 }>(getGetAgentAccessQueryKey(agentId))
		if (
			client.getQueryState(getGetAgentAccessQueryKey(agentId))?.error ||
			permissions.some((permission) => !access?.data.permissions.includes(permission))
		)
			clearAgentContent(client)
	}

	async function refreshAfterAccessError(error: { status: number }): Promise<void> {
		if (error.status === FORBIDDEN_STATUS || error.status === NOT_FOUND_STATUS) await refresh()
	}

	function onSave(): void {
		if (!selected || values.length === 0) return
		remove.reset()
		setNotice(undefined)
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
		if (!selected) return
		save.reset()
		setNotice(undefined)
		remove.mutate(
			{ agentId, roleId: selected.id },
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

	function toggle(permission: Permission) {
		if (!selected) return
		const next = values.includes(permission) ? values.filter((value) => value !== permission) : [...values, permission]
		if ((next.includes("agents:manage") || next.includes("agents:delete")) && !next.includes("agents:read"))
			next.push("agents:read")
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
			<CardContent>
				<div className="space-y-4">
					{query.isPending ? (
						<div className="flex flex-wrap gap-2">
							<output className="sr-only">{t("roles.loading")}</output>
							{Array.from({ length: 3 }, (_, index) => (
								<Skeleton key={index} className="h-control w-28" />
							))}
						</div>
					) : query.isError ? (
						<ProblemAlert error={query.error} onRetry={() => void query.refetch()} />
					) : (
						<>
							<fieldset className="flex flex-wrap gap-2" disabled={pending}>
								<legend className="sr-only">{t("agentAccess.roles")}</legend>
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
								<Select<string>
									value={null}
									onOpenChange={(open) => {
										if (open) focusEditor.current = false
									}}
									onValueChange={(id) => {
										if (id === null) return
										focusEditor.current = true
										setSelectedId(id)
										setDrafts((current) => ({ ...current, [id]: [] }))
										setNotice(undefined)
										save.reset()
										remove.reset()
									}}
								>
									<SelectTrigger
										ref={addRoleButton}
										aria-label={t("agentAccess.addRole")}
										disabled={pending || visible.length === roles.length}
										render={<Button variant="outline" />}
										className="[&>svg:last-child]:hidden"
									>
										<Plus className="size-4" />
										<span>{t("agentAccess.addRole")}</span>
									</SelectTrigger>
									<SelectContent
										align="start"
										className="w-max max-w-[calc(100vw-2rem)]"
										finalFocus={() => (focusEditor.current ? editor.current : addRoleButton.current)}
									>
										{roles
											.filter((role) => !visible.some(({ id }) => id === role.id))
											.map((role) => (
												<SelectItem key={role.id} value={role.id}>
													<span className="truncate" title={role.name}>
														{role.name}
													</span>
												</SelectItem>
											))}
									</SelectContent>
								</Select>
							</fieldset>
							{notice === "removed" && (
								<output className="text-muted-foreground block text-sm">{t("agentAccess.removed")}</output>
							)}
							{roles.length === 0 && (
								<Link to="/dashboard/users/roles" className="text-primary underline">
									{t("roles.create")}
								</Link>
							)}
							{selected ? (
								<fieldset ref={editor} tabIndex={-1} className="space-y-3" disabled={pending}>
									<legend className="sr-only">{t("agentAccess.permissionsFor", { role: selected.name })}</legend>
									<div className="divide-y">
										{(Object.keys(PERMISSION_LABELS) as Permission[]).map((permission) => {
											const id = `access-${agentId}-${permission}`
											const included =
												permission === "agents:read" &&
												(values.includes("agents:manage") || values.includes("agents:delete"))
											const notHeld = !permissions.includes(permission)
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
												<div key={permission} className="flex items-start justify-between gap-6 py-4">
													<div className="space-y-1">
														<Label htmlFor={id}>{t(PERMISSION_LABELS[permission])}</Label>
														<p id={`${id}-description`} className="text-muted-foreground text-sm">
															{t(PERMISSION_DESCRIPTIONS[permission])}
															{hint ? <span className="block">{hint}</span> : null}
														</p>
													</div>
													<Switch
														render={<button type="button" aria-label={t(PERMISSION_LABELS[permission])} />}
														nativeButton
														id={id}
														className="mt-0.5"
														checked={values.includes(permission)}
														disabled={pending || notHeld || included}
														aria-describedby={`${id}-description`}
														onCheckedChange={() => toggle(permission)}
													/>
												</div>
											)
										})}
									</div>
									{save.error && <ProblemAlert error={save.error} />}
									{selected.permissions.length > 0 && values.length === 0 && (
										<output className="text-muted-foreground block text-sm">{t("agentAccess.useRemove")}</output>
									)}
									{selected.permissions.length > 0 ? (
										<div className="flex justify-end pt-2">
											<Button
												variant="destructive"
												disabled={
													pending || selected.permissions.some((permission) => !permissions.includes(permission))
												}
												onClick={() => {
													remove.reset()
													setConfirmRemoveOpen(true)
												}}
											>
												{t("agentAccess.remove")}
											</Button>
										</div>
									) : null}
									<FormActions
										discard={
											selected.permissions.length === 0 ? (
												<Button
													variant="outline"
													onClick={() => {
														clearDraft(selected.id)
														setSelectedId(undefined)
													}}
												>
													{t("agentConfig.cancel")}
												</Button>
											) : undefined
										}
										status={notice === "saved" ? t("agentAccess.saved") : undefined}
									>
										<Button onClick={onSave} disabled={pending || !drafts[selected.id] || values.length === 0}>
											{save.isPending ? t("roles.saving") : t("agentAccess.save")}
										</Button>
									</FormActions>
									<ConfirmDialog
										open={confirmRemoveOpen}
										onOpenChange={(open) => {
											setConfirmRemoveOpen(open)
											if (!open) remove.reset()
										}}
										title={t("agentAccess.remove")}
										description={t("agentAccess.removePrompt", { role: selected.name })}
										cancelLabel={t("agentConfig.cancel")}
										confirmLabel={t("agentAccess.remove")}
										pendingLabel={t("roles.deleting")}
										pending={pending}
										error={remove.error ? getProblemMessage(remove.error, t, t("auth.errorFallback")) : undefined}
										onConfirm={onRemove}
									/>
								</fieldset>
							) : (
								<p className="text-muted-foreground text-sm">{t("agentAccess.empty")}</p>
							)}
						</>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
