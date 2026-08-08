import { bootstrapAdmin } from "@/api/client.ts"
import { ApiError } from "@/api/errors.ts"
import { CredentialsForm } from "@/features/authentication/components/credentials-form.tsx"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"

export const Route = createFileRoute("/setup")({
	component: SetupPage,
})

function SetupPage() {
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
			setError(caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.")
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<main>
			<h1>Create the admin account</h1>
			<p>This is the first time Talqo has run. Create the sole admin account to continue.</p>
			<CredentialsForm
				error={error}
				onSubmit={handleSubmit}
				submitLabel="Create admin account"
				submitting={submitting}
			/>
		</main>
	)
}
