import { useGetSession } from "@/api/generated/identity/identity.ts"
import {
	type DeleteUserMutationError,
	getListUsersQueryKey,
	useCreateInvitation,
	useDeleteUser,
	useGetMyPermissions,
	useListUsers,
	useResetUserPassword,
} from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { resetPasswordSchema, type ResetPasswordFormValues } from "@/features/authentication/change-password-schema.ts"
import { generateRandomPassword } from "@/features/authentication/generate-password.ts"
import { buildInvitationUrl, formatInvitationExpiry } from "@/features/authentication/invitation.ts"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { getProblemMessage } from "@/lib/problem-message.ts"
import { useLanguage } from "@/lib/use-language"
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
import { useNavigate } from "@tanstack/react-router"
import { Check, Copy, UserPlus } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

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

function UsersList() {
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
		return <p className="text-muted-foreground">{t("users.loading")}</p>
	}

	if (usersQuery.isError) {
		// Covers an admin grant revoked while the page is already open.
		if (errorStatus === FORBIDDEN_STATUS) {
			return <AccessDenied resource={t("users.heading")} />
		}
		return (
			<Card>
				<CardContent>
					<p className="text-muted-foreground text-sm">{t("auth.errorFallback")}</p>
				</CardContent>
			</Card>
		)
	}
	const currentUserId = session.data?.data.user?.id
	const users = usersQuery.data.data.users

	return (
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
	)
}

function InviteMemberDialog() {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const createInvitation = useCreateInvitation()
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	function handleOpenChange(next: boolean) {
		setOpen(next)
		if (!next) {
			// A generated link is a one-shot artifact; drop it so the next open starts clean.
			createInvitation.reset()
			setError(null)
			setCopied(false)
		}
	}

	async function handleCreate() {
		setError(null)
		setCopied(false)
		try {
			await createInvitation.mutateAsync()
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("auth.errorFallback")))
		}
	}

	async function copyInvitation(url: string) {
		setError(null)
		setCopied(false)
		try {
			await navigator.clipboard.writeText(url)
			setCopied(true)
		} catch {
			setError(t("auth.invitations.copyFailed"))
		}
	}

	const invite = createInvitation.data?.data
	const inviteUrl = invite ? buildInvitationUrl(window.location.origin, invite.token) : null

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<Button />} nativeButton={false}>
				<UserPlus className="size-4" />
				{t("auth.invitations.heading")}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("auth.invitations.heading")}</DialogTitle>
					<DialogDescription>{t("auth.invitations.description")}</DialogDescription>
				</DialogHeader>
				{error ? (
					<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
						{error}
					</p>
				) : null}
				{invite && inviteUrl ? (
					<div className="bg-muted/50 rounded-surface space-y-3 border p-4">
						<Label htmlFor="invitation-link">{t("auth.invitations.linkLabel")}</Label>
						<div className="flex gap-2">
							<Input id="invitation-link" className="font-mono text-xs" value={inviteUrl} readOnly />
							<Button
								variant="outline"
								size="icon"
								type="button"
								onClick={() => copyInvitation(inviteUrl)}
								aria-label={t("auth.invitations.copy")}
							>
								{copied ? <Check className="text-primary" /> : <Copy />}
							</Button>
						</div>
						<p className="text-muted-foreground text-xs">
							{t("auth.invitations.expiresLabel", {
								date: formatInvitationExpiry(invite.expiresAt, language),
							})}
						</p>
						{copied ? (
							<p className="text-primary text-xs" role="status">
								{t("auth.invitations.copied")}
							</p>
						) : null}
					</div>
				) : null}
				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)}>
						{t("users.cancel")}
					</Button>
					<Button type="button" onClick={handleCreate} disabled={createInvitation.isPending || Boolean(inviteUrl)}>
						{t("auth.invitations.create")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

export function UsersPage() {
	const { t } = useTranslation()
	const permissionsQuery = useGetMyPermissions()
	const isAdmin = permissionsQuery.data?.data.permissions.includes("admin") ?? false

	if (permissionsQuery.isLoading) {
		return <p className="text-muted-foreground">{t("auth.loading")}</p>
	}

	// An unresolved permission is not a denial, so never let it read as one.
	if (permissionsQuery.isError) {
		return <p className="text-muted-foreground">{t("auth.errorFallback")}</p>
	}

	if (!isAdmin) {
		return (
			<div className="mx-auto max-w-3xl space-y-6">
				<PageHeader title={t("users.heading")} description={t("users.subheading")} />
				<AccessDenied resource={t("users.heading")} />
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<PageHeader title={t("users.heading")} description={t("users.subheading")} actions={<InviteMemberDialog />} />
			<UsersList />
		</div>
	)
}
