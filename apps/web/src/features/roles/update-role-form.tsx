import type { Role } from "@/api/generated/models/role.zod"

import { createRoleBodyNameMax } from "@/api/generated/models/roles/createRoleBody.zod"
import { useUpdateRole } from "@/api/generated/roles/roles"
import { ProblemAlert } from "@/components/problem-alert"
import { useAccessError } from "@/features/permissions/use-access-error"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Switch } from "@talqo/ui/components/switch"
import { useBlocker } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { DeleteRoleDialog } from "./delete-role-dialog"
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

export function UpdateRoleForm({
	catalog,
	disabled,
	heldPermissions,
	ownRoles,
	role,
}: {
	catalog: PermissionCatalog
	disabled: boolean
	heldPermissions: readonly string[]
	ownRoles: readonly Role[]
	role: Role
}) {
	const { t } = useTranslation()
	const refreshAccess = useRefreshAccess()
	const updateRole = useUpdateRole({ mutation: { onSuccess: refreshAccess } })
	const [saved, setSaved] = useState(false)
	useAccessError(updateRole.error)
	const {
		control,
		register,
		handleSubmit,
		reset,
		setValue,
		formState: { errors, isDirty, isValid },
	} = useForm<RoleFormValues>({
		resolver: zodResolver(roleFormSchema),
		defaultValues: toRoleFormValues(role),
	})
	useBlocker({
		shouldBlockFn: () => isDirty && !window.confirm(t("roles.leavePrompt")),
		enableBeforeUnload: isDirty,
	})
	// Background refreshes must not replace an unfinished edit.
	useEffect(() => {
		if (!isDirty) reset(toRoleFormValues(role))
	}, [role, reset, isDirty])
	const selected = useWatch({ control, name: "permissions" })
	const included = includedPermissions(selected, catalog)
	const isSaving = updateRole.isPending
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

	return (
		<form onSubmit={handleSubmit(onValid)} className="space-y-6">
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
							{catalog.map(({ permission }) => {
								const includedBy = included.get(permission)
								const notHeld = !heldPermissions.includes(permission)
								const id = `${idPrefix}-${permission.replace(/[:_]/g, "-")}`
								const copy = PERMISSION_COPY[permission]
								const hint = includedBy
									? t("roles.includedWith", { permission: PERMISSION_COPY[includedBy].label(t) })
									: notHeld
										? t("roles.notYours")
										: null
								return (
									<div key={permission} className="flex items-start justify-between gap-6 py-4">
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
											disabled={disabled || isSaving || notHeld || includedBy !== undefined}
											aria-describedby={`${id}-description`}
											onCheckedChange={() => toggle(permission)}
										/>
									</div>
								)
							})}
						</fieldset>
						{locksOut ? (
							<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
								{t("roles.lockoutWarningEdit")}
							</p>
						) : null}
						<ProblemAlert error={updateRole.error} />
						{!disabled ? (
							<>
								{isDirty || saved ? (
									<output className="text-muted-foreground block text-sm">
										{isDirty ? t("roles.unsaved") : t("roles.saved")}
									</output>
								) : null}
								<div className="flex flex-wrap items-center justify-between gap-3 pt-2">
									<DeleteRoleDialog
										role={role}
										disabled={isSaving}
										locksOut={losesRoleManagement({
											heldPermissions,
											rolesBefore: ownRoles,
											rolesAfter: ownRoles.filter(({ id }) => id !== role.id),
										})}
									/>
									<div className="ml-auto flex flex-wrap gap-2">
										{isDirty ? (
											<Button
												type="button"
												variant="outline"
												disabled={isSaving}
												onClick={() => {
													reset(toRoleFormValues(role))
													updateRole.reset()
													setSaved(false)
												}}
											>
												{t("roles.discard")}
											</Button>
										) : null}
										<Button type="submit" disabled={isSaving || !isDirty || !isValid}>
											{isSaving ? t("roles.saving") : t("roles.save")}
										</Button>
									</div>
								</div>
							</>
						) : null}
					</div>
				</CardContent>
			</Card>
		</form>
	)
}
