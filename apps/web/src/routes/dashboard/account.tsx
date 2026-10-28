import {
	getGetSessionQueryKey,
	useChangePassword,
	useGetSession,
	useUpdateCurrentUser,
} from "@/api/generated/identity/identity.ts"
import { useGetMyPermissions, useGetMyRoles } from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { ProblemAlert } from "@/components/problem-alert"
import { DeleteAccountCard } from "@/features/account/delete-account-card"
import { ChangePasswordForm } from "@/features/authentication/components/change-password-form.tsx"
import { getProblemMessage } from "@/lib/problem-message.ts"
import { zodResolver } from "@hookform/resolvers/zod"
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from "@talqo/shared"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"

export const Route = createFileRoute("/dashboard/account")({
	component: AccountPage,
})

const usernameSchema = z.object({
	username: z.string().min(USERNAME_MIN_LENGTH).max(USERNAME_MAX_LENGTH).regex(USERNAME_PATTERN),
})

type UsernameFormValues = z.infer<typeof usernameSchema>

function RolesRow() {
	const { t } = useTranslation()
	const roles = useGetMyRoles()
	const permissions = useGetMyPermissions()
	const isAdmin = permissions.data?.data.permissions.includes("admin") ?? false

	return (
		<div className="space-y-2">
			<h4 className="text-sm font-medium">{t("account.roles")}</h4>
			{roles.isPending ? (
				<p className="text-muted-foreground text-sm">{t("roles.loading")}</p>
			) : roles.isError ? (
				<ProblemAlert error={roles.error} onRetry={() => void roles.refetch()} />
			) : (
				<div className="flex flex-wrap gap-2">
					{isAdmin && <Badge>{t("users.adminBadge")}</Badge>}
					{roles.data.data.roles.map((role) => (
						<Badge key={role.id} variant="outline" className="max-w-full" title={role.name}>
							<span className="max-w-48 truncate">{role.name}</span>
						</Badge>
					))}
					{!isAdmin && roles.data.data.roles.length === 0 && (
						<p className="text-muted-foreground text-sm">{t("account.noRoles")}</p>
					)}
				</div>
			)}
		</div>
	)
}

function UsernameForm({ username }: { username: string }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const updateUser = useUpdateCurrentUser()
	const [serverError, setServerError] = useState<string | null>(null)
	const [saved, setSaved] = useState(false)

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors, isDirty },
	} = useForm<UsernameFormValues>({
		resolver: zodResolver(usernameSchema),
		defaultValues: { username },
	})

	// Follow external username changes (e.g. after a successful save) without clobbering edits.
	useEffect(() => {
		reset({ username })
	}, [username, reset])

	async function onValid(input: UsernameFormValues) {
		setServerError(null)
		setSaved(false)
		try {
			const result = await updateUser.mutateAsync({ data: { username: input.username } })
			// Point the session cache at the renamed user without a refetch; the form stays
			// mounted so the confirmation state below survives.
			queryClient.setQueryData(getGetSessionQueryKey(), (old?: { data: { user: unknown } }) => ({
				...old,
				data: { user: result.data.user },
			}))
			setSaved(true)
		} catch (caught) {
			setServerError(getProblemMessage(caught, t, t("auth.errorFallback")))
		}
	}

	return (
		<form className="space-y-4 border-t pt-6" onSubmit={handleSubmit(onValid)}>
			<div className="space-y-2">
				<Label htmlFor="account-username">{t("account.username")}</Label>
				<Input
					id="account-username"
					autoComplete="username"
					aria-describedby={
						errors.username ? "account-username-description account-username-error" : "account-username-description"
					}
					aria-invalid={errors.username ? true : undefined}
					{...register("username")}
				/>
				<p id="account-username-description" className="text-muted-foreground text-xs">
					{t("account.usernameDescription")}
				</p>
				{errors.username && (
					<p id="account-username-error" className="text-destructive text-xs" role="alert">
						{t("account.usernameInvalid", { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH })}
					</p>
				)}
			</div>
			{serverError && (
				<p className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm" role="alert">
					{serverError}
				</p>
			)}
			{saved && <output className="text-muted-foreground block text-sm">{t("account.usernameSaved")}</output>}
			<Button type="submit" disabled={updateUser.isPending || !isDirty}>
				{t("account.saveUsername")}
			</Button>
		</form>
	)
}

function PasswordSection() {
	const { t } = useTranslation()
	const [error, setError] = useState<string | null>(null)
	const [saved, setSaved] = useState(false)
	// Remounts the form after a successful change so stale passwords don't linger in the fields.
	const [formKey, setFormKey] = useState(0)
	const changePassword = useChangePassword()

	async function handleSubmit(input: { confirmPassword: string; currentPassword: string; newPassword: string }) {
		setError(null)
		setSaved(false)
		try {
			await changePassword.mutateAsync({
				data: { currentPassword: input.currentPassword, newPassword: input.newPassword },
			})
			// The server keeps this session alive for a self-service change, so no login round-trip.
			setSaved(true)
			setFormKey((key) => key + 1)
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("auth.errorFallback")))
		}
	}

	return (
		<section className="space-y-4 border-t pt-6">
			<div className="space-y-1">
				<h4 className="text-sm font-medium">{t("account.password")}</h4>
				<p className="text-muted-foreground text-sm">{t("account.changePasswordDescription")}</p>
			</div>
			<ChangePasswordForm
				key={formKey}
				error={error}
				onSubmit={handleSubmit}
				submitLabel={t("account.changePassword")}
				submitting={changePassword.isPending}
			/>
			{saved && <output className="text-muted-foreground block text-sm">{t("account.passwordSaved")}</output>}
		</section>
	)
}

function AccountSettingsCard({ username }: { username: string }) {
	const { t } = useTranslation()

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("account.settings")}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-6">
					<RolesRow />
					<UsernameForm username={username} />
					<PasswordSection />
				</div>
			</CardContent>
		</Card>
	)
}

function AccountPage() {
	const { t } = useTranslation()
	const session = useGetSession()

	return (
		<div className="space-y-6">
			<PageHeader title={t("account.heading")} description={t("account.subheading")} />
			{session.isPending ? (
				<p className="text-muted-foreground">{t("auth.loading")}</p>
			) : (
				<AccountSettingsCard username={session.data?.data.user?.username ?? ""} />
			)}
			<DeleteAccountCard />
		</div>
	)
}
