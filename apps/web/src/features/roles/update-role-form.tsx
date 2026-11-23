import type { Role } from "@/api/generated/models/role.zod"

import { createRoleBodyNameMax } from "@/api/generated/models/roles/createRoleBody.zod"
import { useUpdateRole } from "@/api/generated/roles/roles"
import { ProblemAlert } from "@/components/problem-alert"
import { useAccessError } from "@/features/permissions/use-access-error"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent } from "@talqo/ui/components/card"
import { FormActions } from "@talqo/ui/components/form-actions"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Switch } from "@talqo/ui/components/switch"
import { useEffect, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { type GrantablePermission, PERMISSION_COPY } from "./permission-labels"
import {
	includedPermissions,
	losesRoleManagement,
	type PermissionCatalog,
	roleFormSchema,
	type RoleFormValues,
	toRoleFormValues,
} from "./role-form"
import { useRefreshAccess } from "./use-refresh-access"

type CatalogEntry = PermissionCatalog[number]

function useSyncedRoleForm(role: Role, onDirtyChange: (dirty: boolean) => void) {
	const form = useForm<RoleFormValues>({
		resolver: zodResolver(roleFormSchema),
		defaultValues: toRoleFormValues(role),
	})
	const { control, formState, reset } = form
	const { isDirty } = formState
	useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange])
	useEffect(() => () => onDirtyChange(false), [onDirtyChange])
	// Background refreshes must not replace an unfinished edit.
	useEffect(() => {
		if (!isDirty) reset(toRoleFormValues(role))
	}, [role, reset, isDirty])
	const selected = useWatch({ control, name: "permissions" })
	return { ...form, selected }
}

function useSavingSync(isSaving: boolean, onSavingChange: (saving: boolean) => void) {
	useEffect(() => onSavingChange(isSaving), [isSaving, onSavingChange])
	useEffect(() => () => onSavingChange(false), [onSavingChange])
}

function useRoleUpdate(role: Role, reset: (values: RoleFormValues) => void) {
	const refreshAccess = useRefreshAccess()
	const updateRole = useUpdateRole({ mutation: { onSuccess: refreshAccess } })
	const [saved, setSaved] = useState(false)
	useAccessError(updateRole.error)

	function onValid(values: RoleFormValues) {
		setSaved(false)
		updateRole.mutate(
			{ roleId: role.id, data: values },
			{
				onSuccess: ({ data }) => {
					reset(toRoleFormValues(data.role))
					setSaved(true)
				},
			},
		)
	}

	return { isSaving: updateRole.isPending, onValid, saved, setSaved, updateRole }
}

function PermissionRow({
	entry,
	idPrefix,
	includedBy,
	locked,
	notHeld,
	onToggle,
	selected,
}: {
	entry: CatalogEntry
	idPrefix: string
	includedBy: GrantablePermission | undefined
	locked: boolean
	notHeld: boolean
	onToggle: (permission: GrantablePermission) => void
	selected: ReadonlyArray<GrantablePermission>
}) {
	const { t } = useTranslation()
	const { permission } = entry
	const copy = PERMISSION_COPY[permission]
	const id = `${idPrefix}-${permission.replaceAll(/[:_]/g, "-")}`
	const hint = includedBy
		? t("roles.includedWith", { permission: PERMISSION_COPY[includedBy].label(t) })
		: notHeld
			? t("roles.notYours")
			: null
	return (
		<div className="flex items-start justify-between gap-6 py-4">
			<div className="space-y-1">
				<Label htmlFor={id}>{copy.label(t)}</Label>
				<p id={`${id}-description`} className="text-muted-foreground text-sm">
					{copy.description(t)}
					{hint ? <span className="block">{hint}</span> : null}
				</p>
			</div>
			<Switch
				render={<button type="button" aria-label={copy.label(t)} />}
				nativeButton
				id={id}
				className="mt-0.5"
				checked={selected.includes(permission) || includedBy !== undefined}
				disabled={locked || notHeld || includedBy !== undefined}
				aria-describedby={`${id}-description`}
				onCheckedChange={() => onToggle(permission)}
			/>
		</div>
	)
}

function RoleFormFooter({
	isDirty,
	isSaving,
	onDiscard,
	saved,
}: {
	isDirty: boolean
	isSaving: boolean
	onDiscard: () => void
	saved: boolean
}) {
	const { t } = useTranslation()
	return (
		<FormActions
			discard={
				isDirty ? (
					<Button type="button" variant="outline" disabled={isSaving} onClick={onDiscard}>
						{t("roles.discard")}
					</Button>
				) : undefined
			}
			status={isDirty ? t("roles.unsaved") : saved ? t("roles.saved") : undefined}
		>
			<Button type="submit" disabled={isSaving || !isDirty}>
				{isSaving ? t("roles.saving") : t("roles.save")}
			</Button>
		</FormActions>
	)
}

export function UpdateRoleForm({
	catalog,
	disabled,
	heldPermissions,
	onDirtyChange,
	onSavingChange,
	ownRoles,
	role,
}: {
	catalog: PermissionCatalog
	disabled: boolean
	heldPermissions: ReadonlyArray<string>
	onDirtyChange: (dirty: boolean) => void
	onSavingChange: (saving: boolean) => void
	ownRoles: ReadonlyArray<Role>
	role: Role
}) {
	const { t } = useTranslation()
	const {
		register,
		handleSubmit,
		reset,
		setFocus,
		setValue,
		formState: { errors, isDirty },
		selected,
	} = useSyncedRoleForm(role, onDirtyChange)
	const { isSaving, onValid, saved, setSaved, updateRole } = useRoleUpdate(role, reset)
	useSavingSync(isSaving, onSavingChange)
	const included = includedPermissions(selected, catalog)
	const idPrefix = `role-${role.id}`
	const locksOut = losesRoleManagement({
		heldPermissions,
		rolesBefore: ownRoles,
		rolesAfter: ownRoles.map((own) => (own.id === role.id ? { permissions: selected } : own)),
	})

	function toggle(permission: GrantablePermission) {
		setValue(
			"permissions",
			selected.includes(permission) ? selected.filter((entry) => entry !== permission) : [...selected, permission],
			{ shouldDirty: true },
		)
		setSaved(false)
	}

	function discard() {
		reset(toRoleFormValues(role))
		updateRole.reset()
		setSaved(false)
	}

	return (
		<div className="space-y-6">
			<form onSubmit={handleSubmit(onValid, () => setFocus("name"))}>
				<Card>
					<CardContent>
						<div className="space-y-5">
							<div className="space-y-2">
								<Label htmlFor={`${idPrefix}-name`}>{t("roles.name")}</Label>
								<Input
									id={`${idPrefix}-name`}
									type="text"
									autoComplete="off"
									disabled={disabled || isSaving}
									aria-invalid={errors.name ? true : undefined}
									aria-describedby={errors.name ? `${idPrefix}-name-error` : undefined}
									{...register("name")}
								/>
								{errors.name ? (
									<p id={`${idPrefix}-name-error`} className="text-destructive text-xs" role="alert">
										{t("roles.nameError", { max: createRoleBodyNameMax })}
									</p>
								) : null}
							</div>
							<fieldset className="divide-y" disabled={disabled || isSaving}>
								<legend className="pb-2 text-sm font-medium">{t("roles.permissionsLegend")}</legend>
								{catalog.map((entry) => (
									<PermissionRow
										key={entry.permission}
										entry={entry}
										idPrefix={idPrefix}
										includedBy={included.get(entry.permission)}
										locked={disabled || isSaving}
										notHeld={!heldPermissions.includes(entry.permission)}
										onToggle={toggle}
										selected={selected}
									/>
								))}
							</fieldset>
							{locksOut ? (
								<p
									className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm"
									role="alert"
								>
									{t("roles.lockoutWarningEdit")}
								</p>
							) : null}
							<ProblemAlert error={updateRole.error} />
							{!disabled ? (
								<RoleFormFooter isDirty={isDirty} isSaving={isSaving} onDiscard={discard} saved={saved} />
							) : null}
						</div>
					</CardContent>
				</Card>
			</form>
		</div>
	)
}
