import { getSession, useCompleteForcedPasswordChange } from "@/api/generated/identity/identity.ts"
import {
	type ForcedPasswordChangeFormValues,
	forcedPasswordChangeSchema,
} from "@/features/authentication/change-password-schema.ts"
import { AuthShell } from "@/features/authentication/components/auth-shell.tsx"
import { NewPasswordFields, PasswordFormError } from "@/features/authentication/components/password-form-fields.tsx"
import { getProblemMessage } from "@/lib/problem-message.ts"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@talqo/ui/components/button"
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

	// No current-password field: the admin-set login is itself the proof.
	async function onValid(values: ForcedPasswordChangeFormValues) {
		setError(null)
		try {
			await completeForcedPasswordChange.mutateAsync({ data: { newPassword: values.newPassword } })
			// The server keeps this session alive, so the member lands signed in.
			await navigate({ to: "/dashboard" })
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("auth.errorFallback")))
		}
	}

	return (
		<AuthShell title={t("auth.forcePasswordChange.heading")} description={t("auth.forcePasswordChange.description")}>
			<form className="space-y-4" noValidate onSubmit={handleSubmit(onValid)}>
				<p className="text-muted-foreground text-xs">{t("auth.requiredNote")}</p>
				<NewPasswordFields
					newPassword={register("newPassword")}
					confirmPassword={register("confirmPassword")}
					errors={errors}
					required
				/>
				<PasswordFormError error={error} />
				<Button className="w-full" size="lg" type="submit" disabled={completeForcedPasswordChange.isPending}>
					{completeForcedPasswordChange.isPending
						? t("auth.forcePasswordChange.pending")
						: t("auth.forcePasswordChange.submit")}
				</Button>
			</form>
		</AuthShell>
	)
}
