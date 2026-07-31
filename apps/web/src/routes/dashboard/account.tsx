import { PageHeader } from "@/components/page-header"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@talqo/ui/components/card"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@talqo/ui/components/dialog"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { useTranslation } from "react-i18next"

import { type Operator, useOperator } from "./-account-query"

export const Route = createFileRoute("/dashboard/account")({
	component: AccountPage,
})

function ProfileCard({ operator }: { operator: Operator }) {
	const { t } = useTranslation()
	const [saved, setSaved] = useState(false)

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setSaved(true)
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("account.profile")}</CardTitle>
				<CardDescription>{t("account.profileDescription")}</CardDescription>
			</CardHeader>
			<form onSubmit={handleSubmit}>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="account-name">{t("account.name")}</Label>
						<Input id="account-name" name="name" defaultValue={operator.name} required />
					</div>
					<div className="space-y-2">
						<Label htmlFor="account-email">{t("account.email")}</Label>
						<Input id="account-email" name="email" type="email" defaultValue={operator.email} required />
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
	const [error, setError] = useState("")
	const [changed, setChanged] = useState(false)

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		const newPassword = String(form.get("newPassword") ?? "")
		const confirmPassword = String(form.get("confirmPassword") ?? "")
		if (newPassword !== confirmPassword) {
			setError(t("account.passwordsMismatch"))
			setChanged(false)
			return
		}
		setError("")
		setChanged(true)
		event.currentTarget.reset()
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("account.changePassword")}</CardTitle>
				<CardDescription>{t("account.changePasswordDescription")}</CardDescription>
			</CardHeader>
			<form onSubmit={handleSubmit}>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="account-current-password">{t("account.currentPassword")}</Label>
						<Input
							id="account-current-password"
							name="currentPassword"
							type="password"
							autoComplete="current-password"
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="account-new-password">{t("account.newPassword")}</Label>
						<Input id="account-new-password" name="newPassword" type="password" autoComplete="new-password" required />
					</div>
					<div className="space-y-2">
						<Label htmlFor="account-confirm-password">{t("account.confirmNewPassword")}</Label>
						<Input
							id="account-confirm-password"
							name="confirmPassword"
							type="password"
							autoComplete="new-password"
							aria-describedby={error ? "password-error" : undefined}
							required
						/>
					</div>
					{error && (
						<p id="password-error" className="text-destructive text-sm">
							{error}
						</p>
					)}
					{changed && <output className="text-muted-foreground block text-sm">{t("account.passwordChanged")}</output>}
				</CardContent>
				<CardFooter>
					<Button type="submit">{t("account.changePassword")}</Button>
				</CardFooter>
			</form>
		</Card>
	)
}

function DangerZoneCard() {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [confirmed, setConfirmed] = useState(false)

	function handleConfirm() {
		setOpen(false)
		setConfirmed(true)
	}

	return (
		<Card className="border-destructive">
			<CardHeader>
				<CardTitle>{t("account.dangerZone")}</CardTitle>
				<CardDescription>{t("account.dangerDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger render={<Button variant="destructive" />}>{t("account.deleteAccount")}</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t("account.deleteAccount")}</DialogTitle>
							<DialogDescription>{t("account.deleteDescription")}</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="outline" onClick={() => setOpen(false)}>
								{t("account.cancel")}
							</Button>
							<Button variant="destructive" onClick={handleConfirm}>
								{t("account.deleteAccount")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
				{confirmed && (
					<output className="text-muted-foreground mt-2 block text-sm">{t("account.deleteConfirmed")}</output>
				)}
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
