import { redeemInvitation } from "@/api/client.ts"
import { ApiError } from "@/api/errors.ts"
import { CredentialsForm } from "@/features/authentication/components/credentials-form.tsx"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"

export const Route = createFileRoute("/accept-invite")({
	validateSearch: (search: Record<string, unknown>): { token: string } => ({
		token: typeof search.token === "string" ? search.token : "",
	}),
	component: AcceptInvitePage,
})

function AcceptInvitePage() {
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
			setError(caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.")
		} finally {
			setSubmitting(false)
		}
	}

	if (!token) {
		return (
			<main>
				<p role="alert">This invitation link is missing its token.</p>
			</main>
		)
	}

	return (
		<main>
			<h1>Complete your account</h1>
			<CredentialsForm error={error} onSubmit={handleSubmit} submitLabel="Create account" submitting={submitting} />
		</main>
	)
}
