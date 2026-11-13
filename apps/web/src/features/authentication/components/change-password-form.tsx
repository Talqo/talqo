import {
	type ChangePasswordFormValues,
	changePasswordSchema,
} from "@/features/authentication/change-password-schema.ts"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@talqo/ui/components/button"
import { FormActions } from "@talqo/ui/components/form-actions"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { NewPasswordFields, PasswordFormError, PasswordFormField } from "./password-form-fields.tsx"

type ChangePasswordFormProps = {
	error: string | null
	onSubmit: (input: ChangePasswordFormValues) => Promise<void> | void
	submitLabel: string
	pendingLabel?: string
	status?: string
	submitting: boolean
}

export function ChangePasswordForm({
	error,
	onSubmit,
	submitLabel,
	pendingLabel,
	status,
	submitting,
}: ChangePasswordFormProps) {
	const { t } = useTranslation()
	const {
		register,
		handleSubmit,
		formState: { errors, isDirty },
	} = useForm<ChangePasswordFormValues>({ resolver: zodResolver(changePasswordSchema) })

	return (
		<form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
			<PasswordFormField
				id="current-password"
				label={t("account.currentPassword")}
				autoComplete="current-password"
				registration={register("currentPassword")}
				error={errors.currentPassword}
				errorMessage={t("account.currentPasswordRequired")}
			/>
			<NewPasswordFields
				newPassword={register("newPassword")}
				confirmPassword={register("confirmPassword")}
				errors={errors}
			/>
			<PasswordFormError error={error} />
			<FormActions status={isDirty ? undefined : status}>
				<Button type="submit" disabled={submitting || !isDirty}>
					{submitting ? (pendingLabel ?? submitLabel) : submitLabel}
				</Button>
			</FormActions>
		</form>
	)
}
