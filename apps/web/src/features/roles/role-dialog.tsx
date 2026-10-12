import type { Role } from "@/api/generated/models/role.zod"

import { createRoleBodyNameMax } from "@/api/generated/models/roles/createRoleBody.zod"
import {
	getGetMyPermissionsQueryKey,
	getListRolesQueryKey,
	getListUsersQueryKey,
	useCreateRole,
	useUpdateRole,
} from "@/api/generated/roles/roles.ts"
import { getProblemMessage } from "@/lib/problem-message.ts"
import { zodResolver } from "@hookform/resolvers/zod"
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
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { type GrantablePermission, PERMISSION_COPY } from "./permission-labels"
import {
	explicitPermissions,
	includedPermissions,
	losesRoleManagement,
	type PermissionCatalog,
	roleFormSchema,
	type RoleFormValues,
} from "./role-form"

export function RoleDialog({
	catalog,
	heldPermissions,
	ownRoles,
	role,
	trigger,
}: {
	catalog: PermissionCatalog
	heldPermissions: readonly string[]
	ownRoles: readonly Role[]
	role?: Role
	trigger: React.ReactElement
}) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const createRole = useCreateRole()
	const updateRole = useUpdateRole()
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const defaultValues: RoleFormValues = { name: role?.name ?? "", permissions: role?.permissions ?? [] }
	const {
		control,
		register,
		handleSubmit,
		reset,
		setValue,
		formState: { errors },
	} = useForm<RoleFormValues>({ resolver: zodResolver(roleFormSchema), defaultValues })
	const selected = useWatch({ control, name: "permissions" })
	const included = includedPermissions(selected, catalog)
	const isSaving = createRole.isPending || updateRole.isPending
	const idPrefix = `role-${role?.id ?? "new"}`
	const locksOut = role ? losesRoleManagement({ heldPermissions, nextPermissions: selected, ownRoles, role }) : false

	function handleOpenChange(next: boolean) {
		if (isSaving) return
		// Reset on open, not close: the role may have changed since this row first rendered.
		if (next) {
			reset(defaultValues)
			setError(null)
		}
		setOpen(next)
	}

	function toggle(permission: GrantablePermission) {
		const next = selected.includes(permission)
			? selected.filter((entry) => entry !== permission)
			: [...selected, permission]
		setValue("permissions", next)
	}

	async function onValid(values: RoleFormValues) {
		setError(null)
		const data = { name: values.name, permissions: explicitPermissions(values.permissions, catalog) }
		try {
			if (role) await updateRole.mutateAsync({ roleId: role.id, data })
			else await createRole.mutateAsync({ data })
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("auth.errorFallback")))
			return
		}
		setOpen(false)
		// Editing a role the operator holds changes their own access, so refresh it too.
		for (const queryKey of [getListRolesQueryKey(), getListUsersQueryKey(), getGetMyPermissionsQueryKey()]) {
			void queryClient.invalidateQueries({ queryKey })
		}
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={trigger} />
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{role ? t("roles.editTitle", { name: role.name }) : t("roles.createTitle")}</DialogTitle>
					<DialogDescription>{t("roles.dialogDescription")}</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit(onValid)} className="space-y-5">
					<div className="space-y-2">
						<Label htmlFor={`${idPrefix}-name`}>{t("roles.name")}</Label>
						<Input
							id={`${idPrefix}-name`}
							type="text"
							autoComplete="off"
							aria-invalid={errors.name ? true : undefined}
							aria-describedby={errors.name ? `${idPrefix}-name-error` : undefined}
							{...register("name")}
						/>
						{errors.name && (
							<p id={`${idPrefix}-name-error`} className="text-destructive text-xs" role="alert">
								{t("roles.nameError", { max: createRoleBodyNameMax })}
							</p>
						)}
					</div>
					<fieldset className="space-y-3">
						<legend className="text-sm font-medium">{t("roles.permissionsLegend")}</legend>
						{catalog.map(({ permission }) => {
							const includedBy = included.get(permission)
							const notHeld = !heldPermissions.includes(permission)
							const id = `${idPrefix}-${permission.replace(/[:_]/g, "-")}`
							const copy = PERMISSION_COPY[permission]
							let hint: string | null = null
							if (includedBy) hint = t("roles.includedWith", { permission: PERMISSION_COPY[includedBy].label(t) })
							else if (notHeld) hint = t("roles.notYours")
							return (
								<div key={permission} className="flex items-start gap-3">
									<input
										id={id}
										type="checkbox"
										className="accent-primary mt-0.5 size-4 shrink-0"
										checked={selected.includes(permission) || includedBy !== undefined}
										disabled={notHeld || includedBy !== undefined}
										aria-describedby={`${id}-description`}
										onChange={() => toggle(permission)}
									/>
									<div className="space-y-0.5">
										<Label htmlFor={id}>{copy.label(t)}</Label>
										<p id={`${id}-description`} className="text-muted-foreground text-xs">
											{copy.description(t)}
											{hint ? <span className="block">{hint}</span> : null}
										</p>
									</div>
								</div>
							)
						})}
					</fieldset>
					{locksOut ? (
						<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
							{t("roles.lockoutWarningEdit")}
						</p>
					) : null}
					{error ? (
						<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
							{error}
						</p>
					) : null}
					<DialogFooter>
						<Button type="button" variant="outline" disabled={isSaving} onClick={() => handleOpenChange(false)}>
							{t("roles.cancel")}
						</Button>
						<Button type="submit" disabled={isSaving}>
							{isSaving ? t("roles.saving") : t("roles.save")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
