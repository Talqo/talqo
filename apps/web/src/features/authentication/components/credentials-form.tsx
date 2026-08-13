import { credentialsFormSchema, type CredentialsFormValues } from "@/features/authentication/credentials-schema.ts"
import { zodResolver } from "@hookform/resolvers/zod"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@talqo/shared"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

type CredentialsFormProps = {
	error: string | null
	onSubmit: (input: CredentialsFormValues) => Promise<void> | void
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
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<CredentialsFormValues>({ resolver: zodResolver(credentialsFormSchema) })

	return (
		<form onSubmit={handleSubmit(onSubmit)}>
			<div>
				<label htmlFor="username">{t("auth.credentialsForm.username")}</label>
				<input
					id="username"
					autoComplete="username"
					aria-invalid={errors.username ? true : undefined}
					{...register("username")}
				/>
				{errors.username && (
					<p role="alert">
						{t("auth.credentialsForm.usernameError", { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH })}
					</p>
				)}
			</div>
			<div>
				<label htmlFor="password">{t("auth.credentialsForm.password")}</label>
				<input
					id="password"
					type="password"
					autoComplete={passwordAutoComplete}
					aria-invalid={errors.password ? true : undefined}
					{...register("password")}
				/>
				{errors.password && (
					<p role="alert">
						{t("auth.credentialsForm.passwordError", { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })}
					</p>
				)}
			</div>
			{error ? <p role="alert">{error}</p> : null}
			<button type="submit" disabled={submitting}>
				{submitLabel}
			</button>
		</form>
	)
}
