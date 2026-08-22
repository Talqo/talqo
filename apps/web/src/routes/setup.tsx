import { useBootstrapAdmin } from "@/api/generated/roles/roles.ts"
import { normalizeApiError } from "@/features/authentication/api-error.ts"
import { AuthShell } from "@/features/authentication/components/auth-shell.tsx"
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
	const bootstrapAdmin = useBootstrapAdmin()

	async function handleSubmit(input: { password: string; username: string }) {
		setError(null)
		try {
			await bootstrapAdmin.mutateAsync({ data: input })
			await navigate({ to: "/login" })
		} catch (caught) {
			setError(normalizeApiError(caught)?.message ?? t("auth.errorFallback"))
		}
	}

	return (
		<AuthShell title={t("auth.setup.heading")} description={t("auth.setup.description")}>
			<CredentialsForm
				error={error}
				onSubmit={handleSubmit}
				requireConfirmation={true}
				submitLabel={t("auth.setup.submit")}
				submitting={bootstrapAdmin.isPending}
			/>
		</AuthShell>
	)
}
