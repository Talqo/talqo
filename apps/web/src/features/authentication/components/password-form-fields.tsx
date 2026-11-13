import type { ForcedPasswordChangeFormValues } from "@/features/authentication/change-password-schema.ts"
import type { FieldError, FieldErrors, UseFormRegisterReturn } from "react-hook-form"

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@talqo/shared"
import { Label } from "@talqo/ui/components/label"
import { PasswordInput } from "@talqo/ui/components/password-input"
import { useTranslation } from "react-i18next"

type PasswordFormFieldProps = {
	id: string
	label: string
	autoComplete: "current-password" | "new-password"
	registration: UseFormRegisterReturn
	error: FieldError | undefined
	errorMessage: string
	required?: boolean
}

export function PasswordFormField({
	id,
	label,
	autoComplete,
	registration,
	error,
	errorMessage,
	required,
}: PasswordFormFieldProps) {
	const { t } = useTranslation()
	const errorId = `${id}-error`
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<PasswordInput
				id={id}
				autoComplete={autoComplete}
				required={required}
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

type NewPasswordFieldsProps = {
	newPassword: UseFormRegisterReturn<"newPassword">
	confirmPassword: UseFormRegisterReturn<"confirmPassword">
	errors: FieldErrors<ForcedPasswordChangeFormValues>
	required?: boolean
}

export function NewPasswordFields({ newPassword, confirmPassword, errors, required }: NewPasswordFieldsProps) {
	const { t } = useTranslation()
	return (
		<>
			<PasswordFormField
				id="new-password"
				label={t("account.newPassword")}
				autoComplete="new-password"
				registration={newPassword}
				error={errors.newPassword}
				errorMessage={t("account.newPasswordError", { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })}
				required={required}
			/>
			<PasswordFormField
				id="confirm-new-password"
				label={t("account.confirmNewPassword")}
				autoComplete="new-password"
				registration={confirmPassword}
				error={errors.confirmPassword}
				errorMessage={t("account.passwordMismatchError")}
				required={required}
			/>
		</>
	)
}

export function PasswordFormError({ error }: { error: string | null }) {
	return error ? (
		<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
			{error}
		</p>
	) : null
}
