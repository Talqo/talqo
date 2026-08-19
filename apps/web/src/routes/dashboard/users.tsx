import { listUsers, resetUserPassword, type PublicUser } from "@/api/client.ts"
import { ApiError } from "@/api/errors.ts"
import { PageHeader } from "@/components/page-header"
import { resetPasswordSchema, type ResetPasswordFormValues } from "@/features/authentication/change-password-schema.ts"
import { generateRandomPassword } from "@/features/authentication/generate-password.ts"
import { zodResolver } from "@hookform/resolvers/zod"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@talqo/shared"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent } from "@talqo/ui/components/card"
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
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Check, Copy } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/users")({
	component: UsersPage,
})

const FORBIDDEN_STATUS = 403
const UNAUTHORIZED_STATUS = 401

type PageState =
	| { status: "loading" }
	| { status: "forbidden" }
	| { status: "error" }
	| { status: "ready"; users: PublicUser[] }

function ResetPasswordDialog({
	disabled,
	onReset,
	targetUser,
}: {
	disabled: boolean
	onReset: (userId: string) => void
	targetUser: PublicUser
}) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)
	const [copied, setCopied] = useState(false)
	const {
		register,
		handleSubmit,
		setValue,
		getValues,
		reset,
		formState: { errors },
	} = useForm<ResetPasswordFormValues>({ resolver: zodResolver(resetPasswordSchema) })

	function handleOpenChange(next: boolean) {
		setOpen(next)
		if (!next) {
			reset()
			setError(null)
			setCopied(false)
		}
	}

	function handleGenerate() {
		const generated = generateRandomPassword()
		setValue("newPassword", generated, { shouldValidate: true })
		setValue("confirmPassword", generated, { shouldValidate: true })
		setCopied(false)
	}

	async function handleCopy() {
		setError(null)
		try {
			await navigator.clipboard.writeText(getValues("newPassword"))
			setCopied(true)
		} catch {
			setError(t("users.copyFailed"))
		}
	}

	async function onValid(values: ResetPasswordFormValues) {
		setSubmitting(true)
		setError(null)
		try {
			await resetUserPassword(targetUser.id, values.newPassword)
			onReset(targetUser.id)
			handleOpenChange(false)
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : t("auth.errorFallback"))
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<Button variant="outline" size="sm" disabled={disabled} />} nativeButton={false}>
				{t("users.resetPassword")}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("users.resetDialogTitle", { username: targetUser.username })}</DialogTitle>
					<DialogDescription>{t("users.resetDialogDescription")}</DialogDescription>
				</DialogHeader>
				<p className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">{t("users.resetWarning")}</p>
				<form onSubmit={handleSubmit(onValid)} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor={`reset-new-password-${targetUser.id}`}>{t("account.newPassword")}</Label>
						<div className="flex gap-2">
							<Input
								id={`reset-new-password-${targetUser.id}`}
								type="text"
								autoComplete="off"
								aria-invalid={errors.newPassword ? true : undefined}
								aria-describedby={errors.newPassword ? `reset-new-password-error-${targetUser.id}` : undefined}
								{...register("newPassword")}
							/>
							<Button type="button" variant="outline" onClick={handleGenerate}>
								{t("users.generate")}
							</Button>
							<Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label={t("users.copy")}>
								{copied ? <Check className="text-primary" /> : <Copy />}
							</Button>
						</div>
						{errors.newPassword && (
							<p id={`reset-new-password-error-${targetUser.id}`} className="text-destructive text-xs" role="alert">
								{t("account.newPasswordError", { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })}
							</p>
						)}
					</div>
					<div className="space-y-2">
						<Label htmlFor={`reset-confirm-password-${targetUser.id}`}>{t("account.confirmNewPassword")}</Label>
						<Input
							id={`reset-confirm-password-${targetUser.id}`}
							type="text"
							autoComplete="off"
							aria-invalid={errors.confirmPassword ? true : undefined}
							aria-describedby={errors.confirmPassword ? `reset-confirm-password-error-${targetUser.id}` : undefined}
							{...register("confirmPassword")}
						/>
						{errors.confirmPassword && (
							<p id={`reset-confirm-password-error-${targetUser.id}`} className="text-destructive text-xs" role="alert">
								{t("account.passwordMismatchError")}
							</p>
						)}
					</div>
					{error ? (
						<p className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm" role="alert">
							{error}
						</p>
					) : null}
					<DialogFooter>
						<Button type="submit" disabled={submitting}>
							{t("users.resetPassword")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

function UsersPage() {
	const { t } = useTranslation()
	const { user: currentUser } = Route.useRouteContext()
	const navigate = useNavigate()
	const [state, setState] = useState<PageState>({ status: "loading" })
	const [confirmedUserId, setConfirmedUserId] = useState<string | null>(null)

	useEffect(() => {
		const controller = new AbortController()
		listUsers(controller.signal)
			.then((usersResult) => {
				setState({ status: "ready", users: usersResult.users })
			})
			.catch((caught) => {
				if (caught instanceof ApiError && caught.status === UNAUTHORIZED_STATUS) {
					void navigate({ to: "/login" })
					return
				}
				setState({ status: caught instanceof ApiError && caught.status === FORBIDDEN_STATUS ? "forbidden" : "error" })
			})
		return () => controller.abort()
	}, [navigate])

	function handleReset(userId: string) {
		setConfirmedUserId(userId)
		setState((previous) =>
			previous.status === "ready"
				? {
						...previous,
						users: previous.users.map((user) => (user.id === userId ? { ...user, mustChangePassword: true } : user)),
					}
				: previous,
		)
	}

	if (state.status === "loading") {
		return (
			<div className="mx-auto max-w-3xl">
				<p className="text-muted-foreground">{t("users.loading")}</p>
			</div>
		)
	}

	if (state.status === "forbidden" || state.status === "error") {
		return (
			<div className="mx-auto max-w-3xl space-y-6">
				<PageHeader title={t("users.heading")} description={t("users.subheading")} />
				<Card>
					<CardContent>
						<p className="text-muted-foreground text-sm">
							{state.status === "forbidden" ? t("users.forbidden") : t("auth.errorFallback")}
						</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<PageHeader title={t("users.heading")} description={t("users.subheading")} />
			<div className="space-y-3">
				{state.users.map((user) => (
					<Card key={user.id}>
						<CardContent className="flex items-center justify-between gap-4">
							<div className="flex items-center gap-2">
								<span className="font-medium">{user.username}</span>
								{user.mustChangePassword && <Badge variant="secondary">{t("users.pendingChange")}</Badge>}
							</div>
							<div className="flex items-center gap-3">
								{confirmedUserId === user.id && (
									<span role="status" className="text-primary text-xs">
										{t("users.resetSuccess")}
									</span>
								)}
								<ResetPasswordDialog targetUser={user} disabled={user.id === currentUser.id} onReset={handleReset} />
							</div>
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	)
}
