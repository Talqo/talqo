import type { Role } from "@/api/generated/models/role.zod"

import {
	type DeleteRoleMutationError,
	getGetMyPermissionsQueryKey,
	getListRolesQueryKey,
	getListUsersQueryKey,
	useDeleteRole,
} from "@/api/generated/roles/roles.ts"
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
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"

const NOT_FOUND_STATUS = 404

export function DeleteRoleDialog({ locksOut, role }: { locksOut: boolean; role: Role }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const deleteRole = useDeleteRole()
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const isDeleting = deleteRole.isPending

	function handleOpenChange(next: boolean) {
		if (isDeleting) return
		setOpen(next)
		if (!next) setError(null)
	}

	async function onConfirm() {
		setError(null)
		try {
			await deleteRole.mutateAsync({ roleId: role.id })
		} catch (caught) {
			// Already deleted elsewhere counts as done; the refreshed list drops the row.
			if ((caught as DeleteRoleMutationError).status !== NOT_FOUND_STATUS) {
				setError(getProblemMessage(caught, t, t("auth.errorFallback")))
				return
			}
		}
		setOpen(false)
		for (const queryKey of [getListRolesQueryKey(), getListUsersQueryKey(), getGetMyPermissionsQueryKey()]) {
			void queryClient.invalidateQueries({ queryKey })
		}
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<Button variant="destructive" />}>{t("roles.delete")}</DialogTrigger>
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
				{error ? (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				) : null}
				<DialogFooter>
					<Button variant="outline" disabled={isDeleting} onClick={() => handleOpenChange(false)}>
						{t("roles.cancel")}
					</Button>
					<Button variant="destructive" disabled={isDeleting} onClick={onConfirm}>
						{isDeleting ? t("roles.deleting") : t("roles.deleteConfirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
