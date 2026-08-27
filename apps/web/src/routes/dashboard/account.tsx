import {
	getGetSessionQueryKey,
	useChangePassword,
	useGetSession,
	useUpdateAccount,
} from "@/api/generated/identity/identity.ts"
import { PageHeader } from "@/components/page-header"
import { ChangePasswordForm } from "@/features/authentication/components/change-password-form.tsx"
import { zodResolver } from "@hookform/resolvers/zod"
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from "@talqo/shared"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"

export const Route = createFileRoute("/dashboard/account")({
	component: AccountPage,
})

const profileSchema = z.object({
	name: z.string().min(USERNAME_MIN_LENGTH).max(USERNAME_MAX_LENGTH).regex(USERNAME_PATTERN),
})

type ProfileFormValues = z.infer<typeof profileSchema>

// Orval fetch errors expose the parsed error body as `info.error`.
function readErrorInfo(caught: unknown): string | undefined {
	return (caught as { info?: { error?: string } } | null)?.info?.error
}

function ProfileCard({ name }: { name: string }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const updateAccount = useUpdateAccount()
	const [serverError, setServerError] = useState<string | null>(null)
	const [saved, setSaved] = useState(false)

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<ProfileFormValues>({
		resolver: zodResolver(profileSchema),
		defaultValues: { name },
	})

	// Follow external name changes (e.g. after a successful save) without clobbering edits.
	useEffect(() => {
		reset({ name })
	}, [name, reset])

	async function onValid(input: ProfileFormValues) {
		setServerError(null)
		setSaved(false)
		if (input.name === name) return
		try {
			const result = await updateAccount.mutateAsync({ data: { username: input.name } })
			// Point the session cache at the renamed user without a refetch; the card stays
			// mounted so the confirmation state below survives.
			queryClient.setQueryData(getGetSessionQueryKey(), (old?: { data: { user: unknown } }) => ({
				...old,
				data: { user: result.data.user },
			}))
			setSaved(true)
		} catch (caught) {
			setServerError(readErrorInfo(caught) ?? t("auth.errorFallback"))
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("account.profile")}</CardTitle>
				<CardDescription>{t("account.profileDescription")}</CardDescription>
			</CardHeader>
			<form onSubmit={handleSubmit(onValid)}>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="account-name">{t("account.name")}</Label>
						<Input
							id="account-name"
							autoComplete="username"
							aria-invalid={errors.name ? true : undefined}
							{...register("name")}
						/>
						{errors.name && (
							<p className="text-destructive text-xs" role="alert">
								{t("account.nameInvalid", { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH })}
							</p>
						)}
					</div>
					{serverError && (
						<p className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm" role="alert">
							{serverError}
						</p>
					)}
					{saved && <output className="text-muted-foreground block text-sm">{t("account.profileSaved")}</output>}
				</CardContent>
				<CardFooter className="border-t-0 bg-transparent">
					<Button type="submit" disabled={updateAccount.isPending}>
						{t("account.saveProfile")}
					</Button>
				</CardFooter>
			</form>
		</Card>
	)
}

function PasswordCard() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const [error, setError] = useState<string | null>(null)
	const changePassword = useChangePassword()

	async function handleSubmit(input: { confirmPassword: string; currentPassword: string; newPassword: string }) {
		setError(null)
		try {
			await changePassword.mutateAsync({
				data: { currentPassword: input.currentPassword, newPassword: input.newPassword },
			})
			// The server already invalidated this session as part of the password change.
			queryClient.clear()
			await navigate({ to: "/login" })
		} catch (caught) {
			setError(readErrorInfo(caught) ?? t("auth.errorFallback"))
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("account.changePassword")}</CardTitle>
				<CardDescription>{t("account.changePasswordDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<ChangePasswordForm
					error={error}
					onSubmit={handleSubmit}
					submitLabel={t("account.changePassword")}
					submitting={changePassword.isPending}
				/>
			</CardContent>
		</Card>
	)
}

function DangerZoneCard() {
	const { t } = useTranslation()

	return (
		<Card className="border-destructive">
			<CardHeader>
				<div className="flex items-center gap-2">
					<CardTitle>{t("account.dangerZone")}</CardTitle>
					<Badge variant="secondary">{t("account.comingSoon")}</Badge>
				</div>
				<CardDescription>{t("account.dangerDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<Button variant="destructive" disabled>
					{t("account.deleteAccount")}
				</Button>
			</CardContent>
		</Card>
	)
}

function AccountPage() {
	const { t } = useTranslation()
	const session = useGetSession()

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<PageHeader title={t("account.heading")} description={t("account.subheading")} />
			{session.isPending ? (
				<p className="text-muted-foreground">{t("auth.loading")}</p>
			) : (
				<ProfileCard name={session.data?.data.user?.username ?? ""} />
			)}
			<PasswordCard />
			<DangerZoneCard />
		</div>
	)
}
