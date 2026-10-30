import { useDeleteCurrentUser } from "@/api/generated/identity/identity"
import { useGetMyPermissions } from "@/api/generated/roles/roles"
import { ProblemAlert } from "@/components/problem-alert"
import { getProblemMessage } from "@/lib/problem-message"
import { Button } from "@talqo/ui/components/button"
import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
import { DangerZone, DangerZoneRow } from "@talqo/ui/components/danger-zone"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export function DeleteAccountCard({ username }: { username: string }) {
	const { t } = useTranslation()
	const permissions = useGetMyPermissions()
	const isAdmin = permissions.data?.data.permissions.includes("admin") ?? false
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const deleteAccount = useDeleteCurrentUser({
		mutation: {
			onSuccess: async () => {
				queryClient.clear()
				await navigate({ to: "/login", ignoreBlocker: true })
			},
		},
	})
	const [open, setOpen] = useState(false)

	if (permissions.isPending || isAdmin) return null

	function handleOpenChange(next: boolean) {
		setOpen(next)
		if (!next) deleteAccount.reset()
	}

	return (
		<DangerZone title={t("account.dangerZone")}>
			{permissions.isError ? (
				<div className="py-4">
					<ProblemAlert error={permissions.error} onRetry={() => void permissions.refetch()} />
				</div>
			) : (
				<DangerZoneRow
					title={t("account.deleteAccount")}
					description={t("account.dangerDescription")}
					action={
						<Button variant="destructive" onClick={() => setOpen(true)}>
							<Trash2 className="size-4" />
							{t("account.deleteAccount")}
						</Button>
					}
				/>
			)}
			<ConfirmDialog
				open={open}
				onOpenChange={handleOpenChange}
				title={t("account.deleteTitle")}
				description={t("account.deletePrompt")}
				cancelLabel={t("account.cancel")}
				confirmLabel={t("account.deleteAccount")}
				pendingLabel={t("account.deleting")}
				pending={deleteAccount.isPending}
				error={deleteAccount.error ? getProblemMessage(deleteAccount.error, t, t("account.deleteFailed")) : undefined}
				typeToConfirm={{
					value: username,
					label: t("account.confirmLabel", { username }),
					placeholder: username,
				}}
				onConfirm={() => deleteAccount.mutate()}
			/>
		</DangerZone>
	)
}
