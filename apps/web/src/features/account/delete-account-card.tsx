import { useDeleteCurrentUser } from "@/api/generated/identity/identity"
import { useGetMyPermissions } from "@/api/generated/roles/roles"
import { ProblemAlert } from "@/components/problem-alert"
import { getProblemMessage } from "@/lib/problem-message"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
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
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export function DeleteAccountCard() {
	const { t } = useTranslation()
	const permissions = useGetMyPermissions()
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const deleteAccount = useDeleteCurrentUser({
		mutation: {
			onSuccess: async () => {
				queryClient.clear()
				await navigate({ to: "/login" })
			},
		},
	})
	const [open, setOpen] = useState(false)

	function handleOpenChange(next: boolean) {
		if (deleteAccount.isPending) return
		setOpen(next)
		if (!next) deleteAccount.reset()
	}

	return (
		<Card className="ring-destructive">
			<CardHeader>
				<CardTitle>{t("account.dangerZone")}</CardTitle>
				<CardDescription>{t("account.dangerDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				{permissions.isPending ? (
					<p className="text-muted-foreground text-sm">{t("auth.loading")}</p>
				) : permissions.isError ? (
					<ProblemAlert error={permissions.error} onRetry={() => void permissions.refetch()} />
				) : permissions.data.data.permissions.includes("admin") ? (
					<p className="text-muted-foreground text-sm">{t("problems.admin-deletion-not-allowed")}</p>
				) : (
					<Dialog open={open} onOpenChange={handleOpenChange}>
						<DialogTrigger render={<Button variant="destructive" />}>{t("account.deleteAccount")}</DialogTrigger>
						<DialogContent showCloseButton={false}>
							<DialogHeader>
								<DialogTitle>{t("account.deleteTitle")}</DialogTitle>
								<DialogDescription>{t("account.deletePrompt")}</DialogDescription>
							</DialogHeader>
							{deleteAccount.error ? (
								<p role="alert" className="text-destructive text-sm">
									{getProblemMessage(deleteAccount.error, t, t("account.deleteFailed"))}
								</p>
							) : null}
							<DialogFooter>
								<Button variant="outline" disabled={deleteAccount.isPending} onClick={() => handleOpenChange(false)}>
									{t("account.cancel")}
								</Button>
								<Button variant="destructive" disabled={deleteAccount.isPending} onClick={() => deleteAccount.mutate()}>
									{deleteAccount.isPending ? t("account.deleting") : t("account.deleteAccount")}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				)}
			</CardContent>
		</Card>
	)
}
