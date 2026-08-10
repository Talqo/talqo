import { PageHeader } from "@/components/page-header"
import { zodResolver } from "@hookform/resolvers/zod"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import { type Operator, useOperator } from "./-account-query"

export const Route = createFileRoute("/dashboard/account")({
	component: AccountPage,
})

const accountSchema = z.object({
	name: z.string().min(1),
	email: z.string().email(),
})

type AccountFormValues = z.infer<typeof accountSchema>

function ProfileCard({ operator }: { operator: Operator }) {
	const { t } = useTranslation()
	const [saved, setSaved] = useState(false)

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<AccountFormValues>({
		resolver: zodResolver(accountSchema),
		defaultValues: { name: operator.name, email: operator.email },
	})

	useEffect(() => {
		reset({ name: operator.name, email: operator.email })
	}, [operator, reset])

	function onValid() {
		setSaved(true)
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
						<Input id="account-name" aria-invalid={errors.name ? true : undefined} {...register("name")} />
						{errors.name && <p className="text-destructive text-xs">{t("account.nameRequired")}</p>}
					</div>
					<div className="space-y-2">
						<Label htmlFor="account-email">{t("account.email")}</Label>
						<Input
							id="account-email"
							type="email"
							aria-invalid={errors.email ? true : undefined}
							{...register("email")}
						/>
						{errors.email && <p className="text-destructive text-xs">{t("account.emailInvalid")}</p>}
					</div>
					{saved && <output className="text-muted-foreground block text-sm">{t("account.profileSaved")}</output>}
				</CardContent>
				<CardFooter>
					<Button type="submit">{t("account.saveProfile")}</Button>
				</CardFooter>
			</form>
		</Card>
	)
}

function PasswordCard() {
	const { t } = useTranslation()

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<CardTitle>{t("account.changePassword")}</CardTitle>
					<Badge variant="secondary">{t("account.comingSoon")}</Badge>
				</div>
				<CardDescription>{t("account.changePasswordDescription")}</CardDescription>
			</CardHeader>
			<fieldset disabled>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="account-current-password">{t("account.currentPassword")}</Label>
						<Input
							id="account-current-password"
							name="currentPassword"
							type="password"
							autoComplete="current-password"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="account-new-password">{t("account.newPassword")}</Label>
						<Input id="account-new-password" name="newPassword" type="password" autoComplete="new-password" />
					</div>
					<div className="space-y-2">
						<Label htmlFor="account-confirm-password">{t("account.confirmNewPassword")}</Label>
						<Input id="account-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" />
					</div>
				</CardContent>
				<CardFooter>
					<Button type="button" disabled>
						{t("account.changePassword")}
					</Button>
				</CardFooter>
			</fieldset>
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
	const { data: operator, isLoading } = useOperator()

	if (isLoading || !operator) {
		return (
			<div className="mx-auto max-w-3xl">
				<p className="text-muted-foreground">{t("account.loading")}</p>
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<PageHeader title={t("account.heading")} description={t("account.subheading")} />
			<ProfileCard operator={operator} />
			<PasswordCard />
			<DangerZoneCard />
		</div>
	)
}
