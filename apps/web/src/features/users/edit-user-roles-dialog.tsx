import type { Role } from "@/api/generated/models/role.zod"

import {
	getGetMyPermissionsQueryKey,
	getListRolesQueryKey,
	getListUsersQueryKey,
	useAssignUserRoles,
} from "@/api/generated/roles/roles.ts"
import { PERMISSION_COPY } from "@/features/roles/permission-labels"
import { holdsAll, losesRoleManagement } from "@/features/roles/role-form"
import { getProblemMessage } from "@/lib/problem-message.ts"
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
import { Label } from "@talqo/ui/components/label"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"

type TargetUser = { id: string; roles: { id: string }[]; username: string }

export function EditUserRolesDialog({
	heldPermissions,
	isSelf,
	ownRoles,
	roles,
	targetUser,
}: {
	heldPermissions: readonly string[]
	isSelf: boolean
	ownRoles: readonly Role[]
	roles: readonly Role[]
	targetUser: TargetUser
}) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const assignRoles = useAssignUserRoles()
	const [open, setOpen] = useState(false)
	const [selected, setSelected] = useState<string[]>([])
	const [error, setError] = useState<string | null>(null)
	const isSaving = assignRoles.isPending
	const locksOut =
		isSelf &&
		losesRoleManagement({
			heldPermissions,
			rolesBefore: ownRoles,
			rolesAfter: roles.filter(({ id }) => selected.includes(id)),
		})

	function handleOpenChange(next: boolean) {
		if (isSaving) return
		// Start from the user's current roles every time; the list may have refreshed since.
		if (next) {
			setSelected(targetUser.roles.map(({ id }) => id))
			setError(null)
		}
		setOpen(next)
	}

	function toggle(roleId: string) {
		setSelected((current) => (current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId]))
	}

	async function onSave() {
		setError(null)
		try {
			await assignRoles.mutateAsync({ userId: targetUser.id, data: { roleIds: selected } })
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("auth.errorFallback")))
			return
		}
		setOpen(false)
		for (const queryKey of [getListUsersQueryKey(), getListRolesQueryKey(), getGetMyPermissionsQueryKey()]) {
			void queryClient.invalidateQueries({ queryKey })
		}
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<Button variant="outline" />}>{t("users.editRoles")}</DialogTrigger>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{t("users.editRolesTitle", { username: targetUser.username })}</DialogTitle>
					<DialogDescription>{t("users.editRolesDescription")}</DialogDescription>
				</DialogHeader>
				{roles.length === 0 ? (
					<p className="text-muted-foreground text-sm">{t("users.noRoles")}</p>
				) : (
					<fieldset className="space-y-3">
						<legend className="sr-only">{t("users.editRolesTitle", { username: targetUser.username })}</legend>
						{roles.map((role) => {
							const notHeld = !holdsAll(heldPermissions, role.permissions)
							const summary = role.permissions.map((permission) => PERMISSION_COPY[permission].label(t)).join(", ")
							const id = `user-${targetUser.id}-role-${role.id}`
							return (
								<div key={role.id} className="flex items-start gap-3">
									<input
										id={id}
										type="checkbox"
										className="accent-primary mt-0.5 size-4 shrink-0"
										checked={selected.includes(role.id)}
										disabled={notHeld}
										aria-describedby={`${id}-description`}
										onChange={() => toggle(role.id)}
									/>
									<div className="min-w-0 space-y-0.5">
										<Label htmlFor={id} className="break-words">
											{role.name}
										</Label>
										<p id={`${id}-description`} className="text-muted-foreground text-xs">
											{summary || t("roles.noAccess")}
											{notHeld ? <span className="block">{t("users.roleNotYours")}</span> : null}
										</p>
									</div>
								</div>
							)
						})}
					</fieldset>
				)}
				{locksOut ? (
					<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
						{t("users.lockoutWarning")}
					</p>
				) : null}
				{error ? (
					<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
						{error}
					</p>
				) : null}
				<DialogFooter>
					<Button variant="outline" disabled={isSaving} onClick={() => handleOpenChange(false)}>
						{t("users.cancel")}
					</Button>
					<Button disabled={isSaving || roles.length === 0} onClick={onSave}>
						{isSaving ? t("users.savingRoles") : t("users.saveRoles")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
