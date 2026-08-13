import type { FormEvent } from "react"

import { useState } from "react"
import { useTranslation } from "react-i18next"

type CredentialsFormProps = {
	error: string | null
	onSubmit: (input: { password: string; username: string }) => Promise<void> | void
	passwordAutoComplete?: "current-password" | "new-password"
	submitLabel: string
	submitting: boolean
}

export function CredentialsForm({
	error,
	onSubmit,
	passwordAutoComplete = "new-password",
	submitLabel,
	submitting,
}: CredentialsFormProps) {
	const { t } = useTranslation()
	const [username, setUsername] = useState("")
	const [password, setPassword] = useState("")

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		await onSubmit({ username, password })
	}

	return (
		<form onSubmit={handleSubmit}>
			<div>
				<label htmlFor="username">{t("auth.credentialsForm.username")}</label>
				<input
					id="username"
					name="username"
					value={username}
					onChange={(event) => setUsername(event.target.value)}
					required
					minLength={3}
					maxLength={32}
					autoComplete="username"
				/>
			</div>
			<div>
				<label htmlFor="password">{t("auth.credentialsForm.password")}</label>
				<input
					id="password"
					name="password"
					type="password"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					required
					minLength={8}
					maxLength={128}
					autoComplete={passwordAutoComplete}
				/>
			</div>
			{error ? <p role="alert">{error}</p> : null}
			<button type="submit" disabled={submitting}>
				{submitLabel}
			</button>
		</form>
	)
}
