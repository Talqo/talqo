import type { FieldError, UseFormRegisterReturn } from "react-hook-form"

import {
	credentialsFormSchema,
	type CredentialsFormValues,
	invitationRegistrationFormSchema,
	registrationFormSchema,
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
	pendingLabel?: string
	requireConfirmation?: boolean
	submitLabel: string
	submitting: boolean
}

function resolveCredentialsSchema(requireConfirmation: boolean, invitationRegistration: boolean) {
	if (!requireConfirmation) return credentialsFormSchema
	return invitationRegistration ? invitationRegistrationFormSchema : registrationFormSchema
}

function UsernameField({
	error,
	registration,
}: {
	error: FieldError | undefined
	registration: UseFormRegisterReturn
}) {
	const { t } = useTranslation()
	return (
		<div className="space-y-2">
			<Label htmlFor="username">{t("auth.credentialsForm.username")}</Label>
			<Input
				id="username"
				autoComplete="username"
				required
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? "username-error" : undefined}
				{...registration}
			/>
			{error && (
				<p id="username-error" className="text-destructive text-xs" role="alert">
					{t("auth.credentialsForm.usernameError", { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH })}
				</p>
			)}
		</div>
	)
}

function CredentialPasswordField({
	autoComplete,
	error,
	errorId,
	errorMessage,
	id,
	label,
	registration,
}: {
	autoComplete: "current-password" | "new-password"
	error: FieldError | undefined
	errorId: string
	errorMessage: string
	id: string
	label: string
	registration: UseFormRegisterReturn
}) {
	const { t } = useTranslation()
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<PasswordInput
				id={id}
				autoComplete={autoComplete}
				required
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? errorId : undefined}
				hideLabel={t("common.hidePassword")}
				showLabel={t("common.showPassword")}
				{...registration}
			/>
			{error && (
				<p id={errorId} className="text-destructive text-xs" role="alert">
					{errorMessage}
				</p>
			)}
		</div>
	)
}

export function CredentialsForm({
	error,
	invitationRegistration = false,
	onSubmit,
	passwordAutoComplete = "new-password",
	pendingLabel,
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
		resolver: zodResolver(resolveCredentialsSchema(requireConfirmation, invitationRegistration)),
	})

	return (
		<form
			className="space-y-4"
			// Keep the native required semantics while the schema controls the messages.
			noValidate
			onSubmit={handleSubmit((input) => onSubmit({ password: input.password, username: input.username }))}
		>
			<p className="text-muted-foreground text-xs">{t("auth.requiredNote")}</p>
			<UsernameField error={errors.username} registration={register("username")} />
			<CredentialPasswordField
				id="password"
				autoComplete={passwordAutoComplete}
				label={t("auth.credentialsForm.password")}
				error={errors.password}
				errorId="password-error"
				errorMessage={t("auth.credentialsForm.passwordError", {
					min: PASSWORD_MIN_LENGTH,
					max: PASSWORD_MAX_LENGTH,
				})}
				registration={register("password")}
			/>
			{requireConfirmation ? (
				<CredentialPasswordField
					id="confirmPassword"
					autoComplete="new-password"
					label={t("auth.credentialsForm.confirmPassword")}
					error={errors.confirmPassword}
					errorId="confirm-password-error"
					errorMessage={t("auth.credentialsForm.passwordMismatchError")}
					registration={register("confirmPassword")}
				/>
			) : null}
			{error ? (
				<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
					{error}
				</p>
			) : null}
			<Button className="w-full" size="lg" type="submit" disabled={submitting}>
				{submitting ? (pendingLabel ?? submitLabel) : submitLabel}
			</Button>
		</form>
	)
}
