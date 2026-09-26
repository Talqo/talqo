import { useGetSession } from "@/api/generated/identity/identity.ts"
import {
	type DeleteUserMutationError,
	getListUsersQueryKey,
	useDeleteUser,
	useListUsers,
	useResetUserPassword,
} from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { resetPasswordSchema, type ResetPasswordFormValues } from "@/features/authentication/change-password-schema.ts"
import { generateRandomPassword } from "@/features/authentication/generate-password.ts"
import { getProblemMessage } from "@/lib/problem-message.ts"
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
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Check, Copy } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/users")({
	component: UsersPage,
})

const FORBIDDEN_STATUS = 403
const NOT_FOUND_STATUS = 404
const UNAUTHORIZED_STATUS = 401

type ListedUser = { id: string; mustChangePassword: boolean; username: string }

function ResetPasswordDialog({
	disabled,
	onReset,
	targetUser,
}: {
	disabled: boolean
	onReset: (userId: string) => void
	targetUser: ListedUser
}) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const resetUserPassword = useResetUserPassword()
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
		setError(null)
		try {
			await resetUserPassword.mutateAsync({ userId: targetUser.id, data: { newPassword: values.newPassword } })
			onReset(targetUser.id)
			handleOpenChange(false)
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("auth.errorFallback")))
		}
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<Button variant="outline" disabled={disabled} />} nativeButton={false}>
				{t("users.resetPassword")}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("users.resetDialogTitle", { username: targetUser.username })}</DialogTitle>
					<DialogDescription>{t("users.resetDialogDescription")}</DialogDescription>
				</DialogHeader>
				<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm">
					{t("users.resetWarning")}
				</p>
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
						<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
							{error}
						</p>
					) : null}
					<DialogFooter>
						<Button type="submit" disabled={resetUserPassword.isPending}>
							{t("users.resetPassword")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

function DeleteUserDialog({
	disabled,
	onDeleted,
	targetUser,
}: {
	disabled: boolean
	onDeleted: () => void
	targetUser: ListedUser
}) {
	const { t } = useTranslation()
	const deleteUser = useDeleteUser()
	const [open, setOpen] = useState(false)
	const [confirmation, setConfirmation] = useState("")
	const [error, setError] = useState<string | null>(null)
	const isDeleting = deleteUser.isPending

	function handleOpenChange(next: boolean) {
		if (isDeleting) return
		setOpen(next)
		if (!next) {
			setConfirmation("")
			setError(null)
		}
	}

	async function onConfirm() {
		setError(null)
		try {
			await deleteUser.mutateAsync({ userId: targetUser.id })
		} catch (caught) {
			// Already deleted elsewhere counts as done; the refreshed list drops the row.
			if ((caught as DeleteUserMutationError).status !== NOT_FOUND_STATUS) {
				setError(getProblemMessage(caught, t, t("auth.errorFallback")))
				return
			}
		}
		setOpen(false)
		onDeleted()
	}

	const confirmationId = `delete-user-confirmation-${targetUser.id}`

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<Button variant="destructive" disabled={disabled} />} nativeButton={false}>
				{t("users.delete")}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("users.deleteTitle")}</DialogTitle>
					<DialogDescription>{t("users.deletePrompt", { username: targetUser.username })}</DialogDescription>
				</DialogHeader>
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				<div className="space-y-2">
					<Label htmlFor={confirmationId}>
						<span className="sr-only">{t("users.confirmLabel", { username: targetUser.username })}</span>
					</Label>
					<Input
						id={confirmationId}
						value={confirmation}
						onChange={(event) => setConfirmation(event.target.value)}
						placeholder={targetUser.username}
						autoComplete="off"
					/>
					<p className="text-muted-foreground text-xs">{t("users.confirmHelp", { username: targetUser.username })}</p>
				</div>
				<DialogFooter>
					<Button variant="outline" disabled={isDeleting} onClick={() => handleOpenChange(false)}>
						{t("users.cancel")}
					</Button>
					<Button
						variant="destructive"
						disabled={confirmation !== targetUser.username || isDeleting}
						onClick={onConfirm}
					>
						{isDeleting ? t("users.deleting") : t("users.deleteConfirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function UsersPage() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const session = useGetSession()
	const usersQuery = useListUsers()
	const [confirmedUserId, setConfirmedUserId] = useState<string | null>(null)

	const errorStatus = (usersQuery.error as { status?: number } | null)?.status

	useEffect(() => {
		if (errorStatus === UNAUTHORIZED_STATUS) void navigate({ to: "/login" })
	}, [errorStatus, navigate])

	function handleReset(userId: string) {
		setConfirmedUserId(userId)
		void queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })
	}

	function handleDeleted() {
		void queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })
	}

	if (usersQuery.isPending || session.isPending) {
		return (
			<div className="mx-auto max-w-3xl">
				<p className="text-muted-foreground">{t("users.loading")}</p>
			</div>
		)
	}

	if (usersQuery.isError) {
		return (
			<div className="mx-auto max-w-3xl space-y-6">
				<PageHeader title={t("users.heading")} description={t("users.subheading")} />
				<Card>
					<CardContent>
						<p className="text-muted-foreground text-sm">
							{errorStatus === FORBIDDEN_STATUS ? t("users.forbidden") : t("auth.errorFallback")}
						</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	const currentUserId = session.data?.data.user?.id
	const users = usersQuery.data.data.users

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<PageHeader title={t("users.heading")} description={t("users.subheading")} />
			<div className="space-y-3">
				{users.map((user) => (
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
								<ResetPasswordDialog targetUser={user} disabled={user.id === currentUserId} onReset={handleReset} />
								<DeleteUserDialog targetUser={user} disabled={user.id === currentUserId} onDeleted={handleDeleted} />
							</div>
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	)
}
