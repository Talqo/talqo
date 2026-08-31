import { useLogin } from "@/api/generated/identity/identity.ts"
import { AuthShell } from "@/features/authentication/components/auth-shell.tsx"
import { CredentialsForm } from "@/features/authentication/components/credentials-form.tsx"
import { getProblemMessage } from "@/lib/problem-message.ts"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/login")({
	component: LoginPage,
})

function LoginPage() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const [error, setError] = useState<string | null>(null)
	const login = useLogin()

	async function handleSubmit(input: { password: string; username: string }) {
		setError(null)
		try {
			await login.mutateAsync({ data: input })
			queryClient.clear()
			await navigate({ to: "/dashboard" })
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("auth.errorFallback")))
		}
	}

	return (
		<AuthShell title={t("auth.login.heading")} description={t("auth.login.description")}>
			<CredentialsForm
				error={error}
				onSubmit={handleSubmit}
				passwordAutoComplete="current-password"
				submitLabel={t("auth.login.submit")}
				submitting={login.isPending}
			/>
		</AuthShell>
	)
}
