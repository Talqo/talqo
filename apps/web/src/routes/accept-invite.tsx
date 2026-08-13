import { redeemInvitation } from "@/api/client.ts"
import { ApiError } from "@/api/errors.ts"
import { CredentialsForm } from "@/features/authentication/components/credentials-form.tsx"
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
	const [submitting, setSubmitting] = useState(false)

	async function handleSubmit(input: { password: string; username: string }) {
		setSubmitting(true)
		setError(null)
		try {
			await redeemInvitation({ token, ...input })
			await navigate({ to: "/login" })
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : t("auth.errorFallback"))
		} finally {
			setSubmitting(false)
		}
	}

	if (!token) {
		return (
			<main>
				<p role="alert">{t("auth.acceptInvite.missingToken")}</p>
			</main>
		)
	}

	return (
		<main>
			<h1>{t("auth.acceptInvite.heading")}</h1>
			<CredentialsForm
				error={error}
				onSubmit={handleSubmit}
				submitLabel={t("auth.acceptInvite.submit")}
				submitting={submitting}
			/>
		</main>
	)
}
