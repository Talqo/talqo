import {
	changePasswordSchema,
	type ChangePasswordFormValues,
} from "@/features/authentication/change-password-schema.ts"
import { zodResolver } from "@hookform/resolvers/zod"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@talqo/shared"
import { Button } from "@talqo/ui/components/button"
import { Label } from "@talqo/ui/components/label"
import { PasswordInput } from "@talqo/ui/components/password-input"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

type ChangePasswordFormProps = {
	error: string | null
	onSubmit: (input: ChangePasswordFormValues) => Promise<void> | void
	submitLabel: string
	submitting: boolean
}

export function ChangePasswordForm({ error, onSubmit, submitLabel, submitting }: ChangePasswordFormProps) {
	const { t } = useTranslation()
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<ChangePasswordFormValues>({ resolver: zodResolver(changePasswordSchema) })

	return (
		<form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
			<div className="space-y-2">
				<Label htmlFor="current-password">{t("account.currentPassword")}</Label>
				<PasswordInput
					id="current-password"
					autoComplete="current-password"
					aria-invalid={errors.currentPassword ? true : undefined}
					aria-describedby={errors.currentPassword ? "current-password-error" : undefined}
					hideLabel={t("common.hidePassword")}
					showLabel={t("common.showPassword")}
					{...register("currentPassword")}
				/>
				{errors.currentPassword && (
					<p id="current-password-error" className="text-destructive text-xs" role="alert">
						{t("account.currentPasswordRequired")}
					</p>
				)}
			</div>
			<div className="space-y-2">
				<Label htmlFor="new-password">{t("account.newPassword")}</Label>
				<PasswordInput
					id="new-password"
					autoComplete="new-password"
					aria-invalid={errors.newPassword ? true : undefined}
					aria-describedby={errors.newPassword ? "new-password-error" : undefined}
					hideLabel={t("common.hidePassword")}
					showLabel={t("common.showPassword")}
					{...register("newPassword")}
				/>
				{errors.newPassword && (
					<p id="new-password-error" className="text-destructive text-xs" role="alert">
						{t("account.newPasswordError", { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })}
					</p>
				)}
			</div>
			<div className="space-y-2">
				<Label htmlFor="confirm-new-password">{t("account.confirmNewPassword")}</Label>
				<PasswordInput
					id="confirm-new-password"
					autoComplete="new-password"
					aria-invalid={errors.confirmPassword ? true : undefined}
					aria-describedby={errors.confirmPassword ? "confirm-new-password-error" : undefined}
					hideLabel={t("common.hidePassword")}
					showLabel={t("common.showPassword")}
					{...register("confirmPassword")}
				/>
				{errors.confirmPassword && (
					<p id="confirm-new-password-error" className="text-destructive text-xs" role="alert">
						{t("account.passwordMismatchError")}
					</p>
				)}
			</div>
			{error ? (
				<p className="bg-destructive/10 text-destructive rounded-surface p-4 text-sm" role="alert">
					{error}
				</p>
			) : null}
			<Button type="submit" disabled={submitting}>
				{submitLabel}
			</Button>
		</form>
	)
}
