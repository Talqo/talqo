import type { Role } from "@/api/generated/models/role.zod"

import { useDeleteRole } from "@/api/generated/roles/roles.ts"
import { getProblemMessage } from "@/lib/problem-message"
import { DEFAULT_ROLE_ID } from "@talqo/shared"
import { Button } from "@talqo/ui/components/button"
import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
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
	const isDefault = role.id === DEFAULT_ROLE_ID

	function handleOpenChange(next: boolean) {
		setOpen(next)
		if (!next) deleteRole.reset()
	}

	function onDeleted() {
		setOpen(false)
		void refreshAccess()
		void navigate({ to: "/dashboard/users/roles", ignoreBlocker: true })
	}

	return (
		<>
			<div className="max-w-sm space-y-2">
				<Button
					type="button"
					variant="destructive"
					disabled={disabled || isDeleting || isDefault}
					aria-describedby={isDefault ? `${role.id}-delete-description` : undefined}
					onClick={() => {
						deleteRole.reset()
						setOpen(true)
					}}
				>
					<Trash2 className="size-4" />
					{t("roles.delete")}
				</Button>
				{isDefault ? (
					<p id={`${role.id}-delete-description`} className="text-muted-foreground text-sm">
						{t("problems.default-role-delete-not-allowed")}
					</p>
				) : null}
			</div>
			<ConfirmDialog
				open={open}
				onOpenChange={handleOpenChange}
				title={t("roles.deleteTitle", { name: role.name })}
				description={
					role.memberCount > 0
						? t("roles.deleteDescription", { people: role.memberCount })
						: t("roles.deleteDescriptionUnused")
				}
				cancelLabel={t("roles.cancel")}
				confirmLabel={t("roles.deleteConfirm")}
				pendingLabel={t("roles.deleting")}
				pending={isDeleting}
				error={deleteRole.error ? getProblemMessage(deleteRole.error, t, t("roles.deleteFailed")) : undefined}
				onConfirm={() => deleteRole.mutate({ roleId: role.id })}
			>
				<p className="text-muted-foreground text-sm">
					{role.memberCount > 0 ? t("roles.deleteRecovery") : t("roles.deleteRecoveryUnused")}
				</p>
				{locksOut ? (
					<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
						{t("roles.lockoutWarningDelete")}
					</p>
				) : null}
			</ConfirmDialog>
		</>
	)
}
