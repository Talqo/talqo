import { getSession, useCompleteForcedPasswordChange } from "@/api/generated/identity/identity.ts"
import {
	forcedPasswordChangeSchema,
	type ForcedPasswordChangeFormValues,
} from "@/features/authentication/change-password-schema.ts"
import { AuthShell } from "@/features/authentication/components/auth-shell.tsx"
import { zodResolver } from "@hookform/resolvers/zod"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@talqo/shared"
import { Button } from "@talqo/ui/components/button"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/force-password-change")({
	beforeLoad: async () => {
		const { user } = (await getSession()).data
		if (!user) throw redirect({ to: "/login" })
		if (!user.mustChangePassword) throw redirect({ to: "/dashboard" })
	},
	component: ForcePasswordChangePage,
})

function ForcePasswordChangePage() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const [error, setError] = useState<string | null>(null)
	const completeForcedPasswordChange = useCompleteForcedPasswordChange()
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<ForcedPasswordChangeFormValues>({ resolver: zodResolver(forcedPasswordChangeSchema) })

	// No current-password field: logging in with the admin-set password is itself the proof.
	async function onValid(values: ForcedPasswordChangeFormValues) {
		setError(null)
		try {
			await completeForcedPasswordChange.mutateAsync({ data: { newPassword: values.newPassword } })
			// The server already invalidated this session as part of the password change.
			await navigate({ to: "/login" })
		} catch (caught) {
			const info = (caught as { info?: { error?: string } } | null)?.info
			setError(info?.error ?? t("auth.errorFallback"))
		}
	}

	return (
		<AuthShell title={t("auth.forcePasswordChange.heading")} description={t("auth.forcePasswordChange.description")}>
			<form className="space-y-4" onSubmit={handleSubmit(onValid)}>
				<div className="space-y-2">
					<Label htmlFor="new-password">{t("account.newPassword")}</Label>
					<Input
						id="new-password"
						type="password"
						autoComplete="new-password"
						aria-invalid={errors.newPassword ? true : undefined}
						aria-describedby={errors.newPassword ? "new-password-error" : undefined}
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
					<Input
						id="confirm-new-password"
						type="password"
						autoComplete="new-password"
						aria-invalid={errors.confirmPassword ? true : undefined}
						aria-describedby={errors.confirmPassword ? "confirm-new-password-error" : undefined}
						{...register("confirmPassword")}
					/>
					{errors.confirmPassword && (
						<p id="confirm-new-password-error" className="text-destructive text-xs" role="alert">
							{t("account.passwordMismatchError")}
						</p>
					)}
				</div>
				{error ? (
					<p className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm" role="alert">
						{error}
					</p>
				) : null}
				<Button type="submit" disabled={completeForcedPasswordChange.isPending}>
					{t("auth.forcePasswordChange.submit")}
				</Button>
			</form>
		</AuthShell>
	)
}
