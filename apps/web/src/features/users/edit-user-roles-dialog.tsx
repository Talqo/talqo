import type { Role } from "@/api/generated/models/role.zod"

import { useAssignUserRoles } from "@/api/generated/roles/roles.ts"
import { ProblemAlert } from "@/components/problem-alert"
import { losesRoleManagement } from "@/features/roles/role-form"
import { RolePicker } from "@/features/roles/role-picker"
import { useRefreshAccess } from "@/features/roles/use-refresh-access"
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
import { Pencil } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

type TargetUser = { id: string; roles: { id: string }[]; username: string }

export function EditUserRolesDialog({
	heldPermissions,
	isSelf,
	ownRoles,
	roles,
	manageableRoleIds,
	targetUser,
}: {
	heldPermissions: readonly string[]
	isSelf: boolean
	ownRoles: readonly Role[]
	roles: readonly Role[]
	manageableRoleIds: readonly string[]
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

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<Button variant="outline" />}>
				<Pencil className="size-4" />
				{t("users.editRoles")}
			</DialogTrigger>
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
						<RolePicker
							heldPermissions={heldPermissions}
							manageableRoleIds={manageableRoleIds}
							roles={roles}
							selected={selected}
							onChange={setSelected}
						/>
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
