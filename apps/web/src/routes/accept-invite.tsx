import { useLogin } from "@/api/generated/identity/identity.ts"
import { useRedeemInvitation } from "@/api/generated/roles/roles.ts"
import { AuthShell } from "@/features/authentication/components/auth-shell.tsx"
import { CredentialsForm } from "@/features/authentication/components/credentials-form.tsx"
<<<<<<< HEAD
import { getProblemMessage } from "@/lib/problem-message.ts"
=======
import { useQueryClient } from "@tanstack/react-query"
>>>>>>> 0347b084 (fix: auto-login after invitation signup and stay signed in after password change)
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
	const queryClient = useQueryClient()
	const [error, setError] = useState<string | null>(null)
	const redeemInvitation = useRedeemInvitation()
	const login = useLogin()

	async function handleSubmit(input: { password: string; username: string }) {
		setError(null)
		try {
			await redeemInvitation.mutateAsync({ data: { token, ...input } })
			// Sign the new member straight in, same as the setup flow.
			await login.mutateAsync({ data: input })
			queryClient.clear()
			await navigate({ to: "/dashboard" })
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("auth.errorFallback")))
		}
	}

	if (!token) {
		return (
			<AuthShell title={t("auth.acceptInvite.heading")}>
				<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
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
				submitting={redeemInvitation.isPending || login.isPending}
			/>
		</AuthShell>
	)
}
