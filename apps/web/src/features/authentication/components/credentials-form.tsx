import {
	credentialsFormSchema,
	invitationRegistrationFormSchema,
	registrationFormSchema,
	type CredentialsFormValues,
} from "@/features/authentication/credentials-schema.ts"
import { zodResolver } from "@hookform/resolvers/zod"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@talqo/shared"
import { Button } from "@talqo/ui/components/button"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { PasswordInput } from "@talqo/ui/components/password-input"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

type CredentialsFormProps = {
	error: string | null
	invitationRegistration?: boolean
	onSubmit: (input: CredentialsFormValues) => Promise<void> | void
	passwordAutoComplete?: "current-password" | "new-password"
	requireConfirmation?: boolean
	submitLabel: string
	submitting: boolean
}

export function CredentialsForm({
	error,
	invitationRegistration = false,
	onSubmit,
	passwordAutoComplete = "new-password",
	requireConfirmation = false,
	submitLabel,
	submitting,
}: CredentialsFormProps) {
	const { t } = useTranslation()
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<CredentialsFormValues>({
		resolver: zodResolver(
			requireConfirmation
				? invitationRegistration
					? invitationRegistrationFormSchema
					: registrationFormSchema
				: credentialsFormSchema,
		),
	})

	return (
		<form
			className="space-y-4"
			onSubmit={handleSubmit((input) => onSubmit({ password: input.password, username: input.username }))}
		>
			<div className="space-y-2">
				<Label htmlFor="username">{t("auth.credentialsForm.username")}</Label>
				<Input
					id="username"
					autoComplete="username"
					aria-invalid={errors.username ? true : undefined}
					aria-describedby={errors.username ? "username-error" : undefined}
					{...register("username")}
				/>
				{errors.username && (
					<p id="username-error" className="text-destructive text-xs" role="alert">
						{t("auth.credentialsForm.usernameError", { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH })}
					</p>
				)}
			</div>
			<div className="space-y-2">
				<Label htmlFor="password">{t("auth.credentialsForm.password")}</Label>
				<PasswordInput
					id="password"
					autoComplete={passwordAutoComplete}
					aria-invalid={errors.password ? true : undefined}
					aria-describedby={errors.password ? "password-error" : undefined}
					hideLabel={t("common.hidePassword")}
					showLabel={t("common.showPassword")}
					{...register("password")}
				/>
				{errors.password && (
					<p id="password-error" className="text-destructive text-xs" role="alert">
						{t("auth.credentialsForm.passwordError", { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })}
					</p>
				)}
			</div>
			{requireConfirmation ? (
				<div className="space-y-2">
					<Label htmlFor="confirmPassword">{t("auth.credentialsForm.confirmPassword")}</Label>
					<PasswordInput
						id="confirmPassword"
						autoComplete="new-password"
						aria-invalid={errors.confirmPassword ? true : undefined}
						aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
						hideLabel={t("common.hidePassword")}
						showLabel={t("common.showPassword")}
						{...register("confirmPassword")}
					/>
					{errors.confirmPassword && (
						<p id="confirm-password-error" className="text-destructive text-xs" role="alert">
							{t("auth.credentialsForm.passwordMismatchError")}
						</p>
					)}
				</div>
			) : null}
			{error ? (
				<p className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm" role="alert">
					{error}
				</p>
			) : null}
			<Button className="w-full" size="lg" type="submit" disabled={submitting}>
				{submitLabel}
			</Button>
		</form>
	)
}
