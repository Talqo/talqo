import type { Role } from "@/api/generated/models/role.zod"

import { useDeleteRole } from "@/api/generated/roles/roles.ts"
import { ProblemAlert } from "@/components/problem-alert"
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
import { useNavigate } from "@tanstack/react-router"
import { Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { useRefreshAccess } from "./use-refresh-access"

const NOT_FOUND_STATUS = 404

export function DeleteRoleDialog({ disabled, locksOut, role }: { disabled: boolean; locksOut: boolean; role: Role }) {
	const { t } = useTranslation()
	const refreshAccess = useRefreshAccess()
	const navigate = useNavigate()
	const deleteRole = useDeleteRole({
		mutation: {
			onSuccess: onDeleted,
			// Already deleted elsewhere counts as done.
			onError: (error) => {
				if (error.status === NOT_FOUND_STATUS) onDeleted()
			},
		},
	})
	const [open, setOpen] = useState(false)
	const isDeleting = deleteRole.isPending

	function handleOpenChange(next: boolean) {
		if (isDeleting) return
		setOpen(next)
		if (!next) deleteRole.reset()
	}

	function onDeleted() {
		setOpen(false)
		void refreshAccess()
		void navigate({ to: "/dashboard/users/roles", ignoreBlocker: true })
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<Button type="button" variant="destructive" disabled={disabled || isDeleting} />}>
				<Trash2 className="size-4" />
				{t("roles.delete")}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("roles.deleteTitle", { name: role.name })}</DialogTitle>
					<DialogDescription>
						{role.memberCount > 0
							? t("roles.deleteDescription", { people: role.memberCount })
							: t("roles.deleteDescriptionUnused")}
					</DialogDescription>
				</DialogHeader>
				<p className="text-muted-foreground text-sm">
					{role.memberCount > 0 ? t("roles.deleteRecovery") : t("roles.deleteRecoveryUnused")}
				</p>
				{locksOut ? (
					<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
						{t("roles.lockoutWarningDelete")}
					</p>
				) : null}
				<ProblemAlert error={deleteRole.error} />
				<DialogFooter>
					<Button variant="outline" disabled={isDeleting} onClick={() => handleOpenChange(false)}>
						{t("roles.cancel")}
					</Button>
					<Button variant="destructive" disabled={isDeleting} onClick={() => deleteRole.mutate({ roleId: role.id })}>
						{isDeleting ? t("roles.deleting") : t("roles.deleteConfirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
