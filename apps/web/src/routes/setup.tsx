import { useLogin } from "@/api/generated/identity/identity.ts"
import { useBootstrapAdmin } from "@/api/generated/roles/roles.ts"
import { AuthShell } from "@/features/authentication/components/auth-shell.tsx"
import { CredentialsForm } from "@/features/authentication/components/credentials-form.tsx"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/setup")({
	component: SetupPage,
})

function SetupPage() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const [error, setError] = useState<string | null>(null)
	const bootstrapAdmin = useBootstrapAdmin()
	const login = useLogin()

	async function handleSubmit(input: { password: string; username: string }) {
		setError(null)
		try {
			await bootstrapAdmin.mutateAsync({ data: input })
			await login.mutateAsync({ data: input })
			queryClient.clear()
			await navigate({ to: "/dashboard" })
		} catch (caught) {
			// Orval fetch errors expose the parsed error body as `info.error`.
			const info = (caught as { info?: { error?: string } } | null)?.info
			setError(info?.error ?? t("auth.errorFallback"))
		}
	}

	return (
		<AuthShell title={t("auth.setup.heading")} description={t("auth.setup.description")}>
			<CredentialsForm
				error={error}
				onSubmit={handleSubmit}
				requireConfirmation={true}
				submitLabel={t("auth.setup.submit")}
				submitting={bootstrapAdmin.isPending || login.isPending}
			/>
		</AuthShell>
	)
}
