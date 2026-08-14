import { login } from "@/api/client.ts"
import { ApiError } from "@/api/errors.ts"
import { AuthShell } from "@/features/authentication/components/auth-shell.tsx"
import { CredentialsForm } from "@/features/authentication/components/credentials-form.tsx"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/login")({
	component: LoginPage,
})

function LoginPage() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	async function handleSubmit(input: { password: string; username: string }) {
		setSubmitting(true)
		setError(null)
		try {
			await login(input)
			await navigate({ to: "/invitations" })
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : t("auth.errorFallback"))
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<AuthShell title={t("auth.login.heading")} description={t("auth.login.description")}>
			<CredentialsForm
				error={error}
				onSubmit={handleSubmit}
				passwordAutoComplete="current-password"
				submitLabel={t("auth.login.submit")}
				submitting={submitting}
			/>
		</AuthShell>
	)
}
