import { bootstrapAdmin } from "@/api/client.ts"
import { ApiError } from "@/api/errors.ts"
import { CredentialsForm } from "@/features/authentication/components/credentials-form.tsx"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/setup")({
	component: SetupPage,
})

function SetupPage() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	async function handleSubmit(input: { password: string; username: string }) {
		setSubmitting(true)
		setError(null)
		try {
			await bootstrapAdmin(input)
			await navigate({ to: "/login" })
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : t("auth.errorFallback"))
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<main>
			<h1>{t("auth.setup.heading")}</h1>
			<p>{t("auth.setup.description")}</p>
			<CredentialsForm
				error={error}
				onSubmit={handleSubmit}
				submitLabel={t("auth.setup.submit")}
				submitting={submitting}
			/>
		</main>
	)
}
