import type { Role } from "@/api/generated/models/role.zod"

import { useAssignUserRoles } from "@/api/generated/roles/roles.ts"
import { ProblemAlert } from "@/components/problem-alert"
import { holdsAll, losesRoleManagement } from "@/features/roles/role-form"
import { useRefreshAccess } from "@/features/roles/use-refresh-access"
import { Button } from "@talqo/ui/components/button"
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
import { Label } from "@talqo/ui/components/label"
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
	const refreshAccess = useRefreshAccess()
	const assignRoles = useAssignUserRoles({
		mutation: {
			onSuccess: () => {
				setOpen(false)
				void refreshAccess()
			},
		},
	})
	const [open, setOpen] = useState(false)
	const [selected, setSelected] = useState<string[]>([])
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
			assignRoles.reset()
		}
		setOpen(next)
	}

	function toggle(roleId: string) {
		setSelected((current) => (current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId]))
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
					<fieldset className="min-w-0 space-y-2">
						<legend className="sr-only">{t("users.editRolesTitle", { username: targetUser.username })}</legend>
						{roles.map((role) => {
							const notHeld = !holdsAll(heldPermissions, role.permissions)
							const id = `user-${targetUser.id}-role-${role.id}`
							return (
								<div
									key={role.id}
									className="rounded-item has-data-checked:border-primary/50 has-data-checked:bg-primary/5 flex min-w-0 items-start gap-3 border p-3"
								>
									<Checkbox
										id={id}
										className="mt-0.5"
										checked={selected.includes(role.id)}
										disabled={notHeld}
										aria-describedby={notHeld ? `${id}-description` : undefined}
										onCheckedChange={() => toggle(role.id)}
									/>
									<div className="min-w-0 flex-1 space-y-1">
										<Label htmlFor={id} className="block truncate leading-5" title={role.name}>
											{role.name}
										</Label>
										{notHeld ? (
											<p id={`${id}-description`} className="text-muted-foreground text-xs">
												{t("users.roleNotYours")}
											</p>
										) : null}
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
				<ProblemAlert error={assignRoles.error} className="bg-destructive/10 rounded-surface p-surface-padding" />
				<DialogFooter>
					<Button variant="outline" disabled={isSaving} onClick={() => handleOpenChange(false)}>
						{t("users.cancel")}
					</Button>
					<Button
						disabled={isSaving || roles.length === 0}
						onClick={() => assignRoles.mutate({ userId: targetUser.id, data: { roleIds: selected } })}
					>
						{isSaving ? t("users.savingRoles") : t("users.saveRoles")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
