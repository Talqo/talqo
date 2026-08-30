import { useRedeemInvitation } from "@/api/generated/roles/roles.ts"
import { AuthShell } from "@/features/authentication/components/auth-shell.tsx"
import { CredentialsForm } from "@/features/authentication/components/credentials-form.tsx"
import { readErrorInfo } from "@/lib/fetch-error"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/accept-invite")({
	validateSearch: (search: Record<string, unknown>): { token: string } => ({
		token: typeof search.token === "string" ? search.token : "",
	}),
	component: AcceptInvitePage,
})

function AcceptInvitePage() {
	const { t } = useTranslation()
	const { token } = Route.useSearch()
	const navigate = useNavigate()
	const [error, setError] = useState<string | null>(null)
	const redeemInvitation = useRedeemInvitation()

	async function handleSubmit(input: { password: string; username: string }) {
		setError(null)
		try {
			await redeemInvitation.mutateAsync({ data: { token, ...input } })
			await navigate({ to: "/login" })
		} catch (caught) {
			setError(readErrorInfo(caught) ?? t("auth.errorFallback"))
		}
	}

	if (!token) {
		return (
			<AuthShell title={t("auth.acceptInvite.heading")}>
				<p className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm" role="alert">
					{t("auth.acceptInvite.missingToken")}
				</p>
			</AuthShell>
		)
	}

	return (
		<AuthShell title={t("auth.acceptInvite.heading")} description={t("auth.acceptInvite.description")}>
			<CredentialsForm
				error={error}
				invitationRegistration={true}
				onSubmit={handleSubmit}
				requireConfirmation={true}
				submitLabel={t("auth.acceptInvite.submit")}
				submitting={redeemInvitation.isPending}
			/>
		</AuthShell>
	)
}
