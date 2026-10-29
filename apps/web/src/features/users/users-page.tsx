import { useGetSession } from "@/api/generated/identity/identity.ts"
import {
	type DeleteUserMutationError,
	getListUsersQueryKey,
	useCreateInvitation,
	useDeleteUser,
	useGetMyPermissions,
	useListRoles,
	useListUsers,
	useResetUserPassword,
} from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { ProblemAlert } from "@/components/problem-alert"
import { type ResetPasswordFormValues, resetPasswordSchema } from "@/features/authentication/change-password-schema.ts"
import { generateRandomPassword } from "@/features/authentication/generate-password.ts"
import { buildInvitationUrl } from "@/features/authentication/invitation.ts"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { useAccessError } from "@/features/permissions/use-access-error"
import { holdsAll } from "@/features/roles/role-form"
import { RolePicker } from "@/features/roles/role-picker"
import { formatDateTime } from "@/lib/format-date"
import { getProblemMessage } from "@/lib/problem-message.ts"
import { useLanguage } from "@/lib/use-language"
import { zodResolver } from "@hookform/resolvers/zod"
import { DEFAULT_ROLE_ID, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@talqo/shared"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader } from "@talqo/ui/components/card"
import { CardName } from "@talqo/ui/components/card-name"
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
import { Skeleton } from "@talqo/ui/components/skeleton"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Check, Copy, Pencil, Trash2, UserPlus } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { EditUserRolesDialog } from "./edit-user-roles-dialog"

const NOT_FOUND_STATUS = 404

type ListedUser = { id: string; username: string }

function ResetPasswordDialog({ onReset, targetUser }: { onReset: (userId: string) => void; targetUser: ListedUser }) {
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
			<DialogTrigger render={<Button variant="outline" />}>{t("users.resetPassword")}</DialogTrigger>
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

function DeleteUserDialog({ onDeleted, targetUser }: { onDeleted: () => void; targetUser: ListedUser }) {
	const { t } = useTranslation()
	const deleteUser = useDeleteUser()
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const isDeleting = deleteUser.isPending

	function handleOpenChange(next: boolean) {
		if (isDeleting) return
		setOpen(next)
		if (!next) setError(null)
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

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<Button variant="destructive" />}>
				<Trash2 className="size-4" />
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
				<DialogFooter>
					<Button variant="outline" disabled={isDeleting} onClick={() => handleOpenChange(false)}>
						{t("users.cancel")}
					</Button>
					<Button variant="destructive" disabled={isDeleting} onClick={onConfirm}>
						{isDeleting ? t("users.deleting") : t("users.deleteConfirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function UsersSkeleton({ label }: { label: string }) {
	return (
		<div className="space-y-3">
			<output className="sr-only">{label}</output>
			{Array.from({ length: 3 }, (_, index) => (
				<Card key={index}>
					<CardHeader>
						<Skeleton className="h-5 w-32 max-w-full" />
						<div className="flex flex-wrap items-center gap-2">
							<Skeleton className="h-5 w-16" />
							<Skeleton className="h-5 w-20" />
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex flex-wrap items-center gap-3">
							<Skeleton className="h-9 w-28" />
							<Skeleton className="h-9 w-28" />
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	)
}

function UsersList({ held }: { held: readonly string[] }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const session = useGetSession()
	const usersQuery = useListUsers()
	const canManageUsers = held.includes("users:manage")
	const canManageRoles = held.includes("roles:manage")
	const rolesQuery = useListRoles({ query: { enabled: canManageRoles } })
	const [confirmedUserId, setConfirmedUserId] = useState<string | null>(null)

	const forbidden = useAccessError(usersQuery.error, session.error, rolesQuery.error)

	function handleReset(userId: string) {
		setConfirmedUserId(userId)
		void queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })
	}

	function handleDeleted() {
		void queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })
	}

	if (usersQuery.isPending || session.isPending) {
		return <UsersSkeleton label={t("users.loading")} />
	}

	if (usersQuery.isError || session.isError) {
		// A role removed while the page is open still lands here.
		if (forbidden) return <AccessDenied />
		return (
			<ProblemAlert
				error={usersQuery.error ?? session.error}
				onRetry={() => {
					void usersQuery.refetch()
					void session.refetch()
				}}
			/>
		)
	}
	const currentUserId = session.data?.data.user?.id
	const users = usersQuery.data.data.users
	const roles = rolesQuery.data?.data.roles
	const ownRoleIds = new Set(users.find(({ id }) => id === currentUserId)?.roles.map(({ id }) => id) ?? [])
	const ownRoles = roles?.filter(({ id }) => ownRoleIds.has(id)) ?? []

	return (
		<div className="space-y-3">
			{canManageRoles && rolesQuery.isPending ? (
				<div className="space-y-2">
					<output className="sr-only">{t("roles.loading")}</output>
					<Skeleton className="h-4 w-40 max-w-full" />
				</div>
			) : null}
			{canManageRoles ? <ProblemAlert error={rolesQuery.error} onRetry={() => void rolesQuery.refetch()} /> : null}
			{users.map((user) => {
				const exceedsOperator = !user.canManage
				return (
					<Card key={user.id} data-user-id={user.id}>
						<CardHeader>
							<CardName>{user.username}</CardName>
							{(user.permissions.includes("admin") || user.roles.length > 0 || user.mustChangePassword) && (
								<CardDescription className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										{user.permissions.includes("admin") && <Badge>{t("users.adminBadge")}</Badge>}
										{user.roles.map((role) => (
											<Badge key={role.id} variant="outline" className="max-w-full" title={role.name}>
												<span className="max-w-48 truncate">{role.name}</span>
											</Badge>
										))}
										{user.mustChangePassword && <Badge variant="secondary">{t("users.pendingChange")}</Badge>}
									</div>
								</CardDescription>
							)}
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								<div className="flex flex-wrap items-center gap-3">
									{confirmedUserId === user.id && (
										<output className="text-primary text-xs">{t("users.resetSuccess")}</output>
									)}
									{canManageRoles && roles && !rolesQuery.isError ? (
										<EditUserRolesDialog
											heldPermissions={held}
											isSelf={user.id === currentUserId}
											ownRoles={ownRoles}
											roles={roles}
											manageableRoleIds={rolesQuery.data?.data.manageableRoleIds ?? []}
											targetUser={user}
										/>
									) : canManageRoles ? (
										<Button variant="outline" disabled aria-busy={rolesQuery.isPending}>
											<Pencil className="size-4" />
											{t("users.editRoles")}
										</Button>
									) : null}
									{canManageUsers && exceedsOperator ? (
										<p className="text-muted-foreground max-w-xs text-xs">{t("users.cannotChange")}</p>
									) : null}
									{canManageUsers && !exceedsOperator && user.id !== currentUserId ? (
										<>
											<ResetPasswordDialog targetUser={user} onReset={handleReset} />
											<DeleteUserDialog targetUser={user} onDeleted={handleDeleted} />
										</>
									) : null}
								</div>
								{canManageUsers && user.id === currentUserId ? (
									<p className="text-muted-foreground text-xs">
										{t("users.ownAccountHint")}{" "}
										<Link to="/dashboard/account" className="underline">
											{t("nav.account")}
										</Link>
									</p>
								) : null}
							</div>
						</CardContent>
					</Card>
				)
			})}
		</div>
	)
}

function InviteMemberDialog({ held }: { held: readonly string[] }) {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const createInvitation = useCreateInvitation()
	const canAssignRoles = held.includes("roles:manage")
	const rolesQuery = useListRoles({ query: { enabled: canAssignRoles } })
	const roles = rolesQuery.data?.data.roles ?? []
	const [selected, setSelected] = useState<string[]>([])
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	function handleOpenChange(next: boolean) {
		if (createInvitation.isPending) return
		if (next)
			setSelected(
				roles
					.filter(
						(role) =>
							role.id === DEFAULT_ROLE_ID &&
							holdsAll(held, role.permissions) &&
							rolesQuery.data?.data.manageableRoleIds.includes(role.id),
					)
					.map(({ id }) => id),
			)
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
			await createInvitation.mutateAsync({ data: { roleIds: selected } })
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
			<DialogTrigger render={<Button disabled={canAssignRoles && rolesQuery.isPending} />}>
				<UserPlus className="size-4" />
				{t("auth.invitations.heading")}
			</DialogTrigger>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{t("auth.invitations.heading")}</DialogTitle>
				</DialogHeader>
				{canAssignRoles && rolesQuery.isError ? (
					<ProblemAlert error={rolesQuery.error} onRetry={() => void rolesQuery.refetch()} />
				) : null}
				{canAssignRoles && rolesQuery.data ? (
					<fieldset className="min-w-0 space-y-2">
						<legend className="mb-2 text-sm font-medium">{t("auth.invitations.roles")}</legend>
						<RolePicker
							manageableRoleIds={rolesQuery.data.data.manageableRoleIds}
							disabled={createInvitation.isPending || Boolean(inviteUrl)}
							heldPermissions={held}
							roles={roles}
							selected={selected}
							onChange={setSelected}
						/>
					</fieldset>
				) : null}
				{selected.length === 0 ? (
					<p className="text-muted-foreground text-xs">{t("auth.invitations.noRoles")}</p>
				) : null}
				{error ? (
					<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
						{error}
					</p>
				) : null}
				{invite && inviteUrl ? (
					<div className="bg-muted/50 rounded-surface space-y-3 border p-4">
						<Label htmlFor="invitation-link">{t("auth.invitations.linkLabel")}</Label>
						<div className="flex gap-2">
							<Input id="invitation-link" font="mono" value={inviteUrl} readOnly />
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
								date: formatDateTime(invite.expiresAt, language),
							})}
						</p>
						{copied ? <output className="text-primary block text-xs">{t("auth.invitations.copied")}</output> : null}
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
	const held = useGetMyPermissions().data?.data.permissions ?? []

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("users.heading")}
				description={t("users.subheading")}
				actions={held.includes("users:manage") ? <InviteMemberDialog held={held} /> : null}
			/>
			<UsersList held={held} />
		</div>
	)
}
