import type { Role } from "@/api/generated/models/role.zod"
import type { CreateInvitation201 } from "@/api/generated/models/roles/createInvitation201.zod"
import type { ListUsers200Output } from "@/api/generated/models/roles/listUsers200.zod"

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
import { FloatingActionButton } from "@/components/floating-action-button"
import { PageHeader } from "@/components/page-header"
import { SkeletonList } from "@/components/page-skeleton"
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
import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
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
import { Check, Copy, Pencil, Trash2, UserPlus } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { EditMemberRolesDialog } from "./edit-member-roles-dialog"
import { TeamRolesSwitcher } from "./team-roles-switcher"

const NOT_FOUND_STATUS = 404

type ListedUser = { id: string; username: string }
type TeamMember = ListUsers200Output["users"][number]

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

	function close() {
		setOpen(false)
		reset()
		resetUserPassword.reset()
		setError(null)
		setCopied(false)
	}

	function handleOpenChange(next: boolean) {
		if (resetUserPassword.isPending) return
		if (next) setOpen(true)
		else close()
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
			setError(t("team.copyFailed"))
		}
	}

	async function onValid(values: ResetPasswordFormValues) {
		setError(null)
		try {
			await resetUserPassword.mutateAsync({ userId: targetUser.id, data: { newPassword: values.newPassword } })
			onReset(targetUser.id)
			close()
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("auth.errorFallback")))
		}
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<Button variant="outline" />}>{t("team.resetPassword")}</DialogTrigger>
			<DialogContent closeLabel={t("common.close")}>
				<DialogHeader>
					<DialogTitle>{t("team.resetDialogTitle", { username: targetUser.username })}</DialogTitle>
					<DialogDescription>{t("team.resetDialogDescription")}</DialogDescription>
				</DialogHeader>
				<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm">
					{t("team.resetWarning")}
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
								{t("team.generate")}
							</Button>
							<Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label={t("team.copy")}>
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
						<Button
							type="button"
							variant="outline"
							disabled={resetUserPassword.isPending}
							onClick={() => handleOpenChange(false)}
						>
							{t("team.cancel")}
						</Button>
						<Button type="submit" disabled={resetUserPassword.isPending}>
							{resetUserPassword.isPending ? t("team.resetting") : t("team.resetPassword")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

function DeleteMemberDialog({ onDeleted, targetUser }: { onDeleted: () => void; targetUser: ListedUser }) {
	const { t } = useTranslation()
	const deleteUser = useDeleteUser()
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)

	function handleOpenChange(next: boolean) {
		setOpen(next)
		if (!next) {
			setError(null)
			deleteUser.reset()
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

	return (
		<>
			<Button variant="destructive" onClick={() => setOpen(true)}>
				<Trash2 className="size-4" />
				{t("team.delete")}
			</Button>
			<ConfirmDialog
				open={open}
				onOpenChange={handleOpenChange}
				title={t("team.deleteTitle")}
				description={t("team.deletePrompt", { username: targetUser.username })}
				cancelLabel={t("team.cancel")}
				confirmLabel={t("team.deleteConfirm")}
				pendingLabel={t("team.deleting")}
				pending={deleteUser.isPending}
				error={error ?? undefined}
				onConfirm={() => void onConfirm()}
			/>
		</>
	)
}

function TeamSkeleton() {
	const { t } = useTranslation()
	return (
		<SkeletonList label={t("team.loading")}>
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
		</SkeletonList>
	)
}

function hasMemberBadges(user: TeamMember): boolean {
	return user.permissions.includes("admin") || user.roles.length > 0 || Boolean(user.mustChangePassword)
}

function MemberBadges({ user }: { user: TeamMember }) {
	const { t } = useTranslation()
	return (
		<CardDescription className="min-w-0">
			<div className="flex flex-wrap items-center gap-2">
				{user.permissions.includes("admin") && <Badge>{t("team.adminBadge")}</Badge>}
				{user.roles.map((role) => (
					<Badge key={role.id} variant="outline" className="max-w-full" title={role.name}>
						<span className="max-w-48 truncate">{role.name}</span>
					</Badge>
				))}
				{user.mustChangePassword && <Badge variant="secondary">{t("team.pendingChange")}</Badge>}
			</div>
		</CardDescription>
	)
}

function MemberRoleEditor({
	currentUserId,
	held,
	manageableRoleIds,
	ownRoles,
	roles,
	rolesFailed,
	rolesLoading,
	user,
}: {
	currentUserId: string | undefined
	held: ReadonlyArray<string>
	manageableRoleIds: ReadonlyArray<string>
	ownRoles: ReadonlyArray<Role>
	roles: ReadonlyArray<Role> | undefined
	rolesFailed: boolean
	rolesLoading: boolean
	user: TeamMember
}) {
	const { t } = useTranslation()
	if (!held.includes("roles:manage")) return null
	if (!roles || rolesFailed) {
		return (
			<Button variant="outline" disabled aria-busy={rolesLoading}>
				<Pencil className="size-4" />
				{t("team.editRoles")}
			</Button>
		)
	}
	return (
		<EditMemberRolesDialog
			heldPermissions={held}
			isSelf={user.id === currentUserId}
			ownRoles={ownRoles}
			roles={roles}
			manageableRoleIds={manageableRoleIds}
			targetUser={user}
		/>
	)
}

function MemberCard({
	confirmed,
	currentUserId,
	held,
	manageableRoleIds,
	onDeleted,
	onReset,
	ownRoles,
	roles,
	rolesFailed,
	rolesLoading,
	user,
}: {
	confirmed: boolean
	currentUserId: string | undefined
	held: ReadonlyArray<string>
	manageableRoleIds: ReadonlyArray<string>
	onDeleted: () => void
	onReset: (userId: string) => void
	ownRoles: ReadonlyArray<Role>
	roles: ReadonlyArray<Role> | undefined
	rolesFailed: boolean
	rolesLoading: boolean
	user: TeamMember
}) {
	const { t } = useTranslation()
	const canManageUsers = held.includes("users:manage")
	const exceedsOperator = !user.canManage

	return (
		<Card data-user-id={user.id}>
			<CardHeader>
				<CardName>{user.username}</CardName>
				{hasMemberBadges(user) ? <MemberBadges user={user} /> : null}
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					<div className="flex flex-wrap items-center gap-3">
						{confirmed && <output className="text-primary text-xs">{t("team.resetSuccess")}</output>}
						<MemberRoleEditor
							currentUserId={currentUserId}
							held={held}
							ownRoles={ownRoles}
							roles={roles}
							manageableRoleIds={manageableRoleIds}
							rolesFailed={rolesFailed}
							rolesLoading={rolesLoading}
							user={user}
						/>
						{canManageUsers && exceedsOperator ? (
							<p className="text-muted-foreground max-w-xs text-xs">{t("team.cannotChange")}</p>
						) : null}
						{canManageUsers && !exceedsOperator && user.id !== currentUserId ? (
							<>
								<ResetPasswordDialog targetUser={user} onReset={onReset} />
								<DeleteMemberDialog targetUser={user} onDeleted={onDeleted} />
							</>
						) : null}
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

function ownRolesOf(
	users: ReadonlyArray<TeamMember>,
	currentUserId: string | undefined,
	roles: ReadonlyArray<Role> | undefined,
): Array<Role> {
	const ownRoleIds = new Set(users.find(({ id }) => id === currentUserId)?.roles.map(({ id }) => id))
	return roles?.filter(({ id }) => ownRoleIds.has(id)) ?? []
}

function TeamRolesStatus({ error, onRetry, pending }: { error: Error | null; onRetry: () => void; pending: boolean }) {
	const { t } = useTranslation()
	return (
		<>
			{pending ? (
				<div className="space-y-2">
					<output className="sr-only">{t("roles.loading")}</output>
					<Skeleton className="h-4 w-40 max-w-full" />
				</div>
			) : null}
			<ProblemAlert error={error} onRetry={onRetry} />
		</>
	)
}

function TeamLoadError({ error, forbidden, onRetry }: { error: unknown; forbidden: boolean; onRetry: () => void }) {
	if (forbidden) return <AccessDenied />
	return <ProblemAlert error={error} onRetry={onRetry} />
}

function TeamList({ held }: { held: ReadonlyArray<string> }) {
	const queryClient = useQueryClient()
	const session = useGetSession()
	const usersQuery = useListUsers()
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
		return <TeamSkeleton />
	}

	if (usersQuery.isError || session.isError) {
		// A role removed while the page is open still lands here.
		return (
			<TeamLoadError
				error={usersQuery.error ?? session.error}
				forbidden={forbidden}
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
	const manageableRoleIds = rolesQuery.data?.data.manageableRoleIds ?? []
	const ownRoles = ownRolesOf(users, currentUserId, roles)

	return (
		<div className="space-y-3">
			{canManageRoles ? (
				<TeamRolesStatus
					error={rolesQuery.error}
					onRetry={() => void rolesQuery.refetch()}
					pending={rolesQuery.isPending}
				/>
			) : null}
			{users.map((user) => (
				<MemberCard
					key={user.id}
					user={user}
					held={held}
					currentUserId={currentUserId}
					ownRoles={ownRoles}
					roles={roles}
					manageableRoleIds={manageableRoleIds}
					rolesFailed={rolesQuery.isError}
					rolesLoading={rolesQuery.isPending}
					confirmed={confirmedUserId === user.id}
					onReset={handleReset}
					onDeleted={handleDeleted}
				/>
			))}
		</div>
	)
}

function defaultInviteRoleIds(
	roles: ReadonlyArray<Role> | undefined,
	manageableRoleIds: ReadonlyArray<string>,
	held: ReadonlyArray<string>,
): Array<string> {
	return (roles ?? [])
		.filter(
			(role) => role.id === DEFAULT_ROLE_ID && manageableRoleIds.includes(role.id) && holdsAll(held, role.permissions),
		)
		.map(({ id }) => id)
}

function InviteRolesField({
	disabled,
	error,
	held,
	manageableRoleIds,
	onChange,
	onRetry,
	roles,
	selected,
}: {
	disabled: boolean
	error: Error | null
	held: ReadonlyArray<string>
	manageableRoleIds: ReadonlyArray<string>
	onChange: (selected: Array<string>) => void
	onRetry: () => void
	roles: ReadonlyArray<Role> | undefined
	selected: ReadonlyArray<string>
}) {
	const { t } = useTranslation()
	return (
		<>
			{error ? <ProblemAlert error={error} onRetry={onRetry} /> : null}
			{roles ? (
				<fieldset className="min-w-0 space-y-2">
					<legend className="mb-2 text-sm font-medium">{t("auth.invitations.roles")}</legend>
					<RolePicker
						manageableRoleIds={manageableRoleIds}
						disabled={disabled}
						heldPermissions={held}
						roles={roles}
						selected={selected}
						onChange={onChange}
					/>
				</fieldset>
			) : null}
		</>
	)
}

function InvitationLinkPanel({
	copied,
	expiresAt,
	onCopy,
	url,
}: {
	copied: boolean
	expiresAt: string
	onCopy: () => void
	url: string
}) {
	const { t } = useTranslation()
	const { language } = useLanguage()
	return (
		<div className="bg-muted/50 rounded-surface space-y-3 border p-4">
			<Label htmlFor="invitation-link">{t("auth.invitations.linkLabel")}</Label>
			<div className="flex gap-2">
				<Input id="invitation-link" font="mono" value={url} readOnly />
				<Button variant="outline" size="icon" type="button" onClick={onCopy} aria-label={t("auth.invitations.copy")}>
					{copied ? <Check className="text-primary" /> : <Copy />}
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				{t("auth.invitations.expiresLabel", {
					date: formatDateTime(expiresAt, language),
				})}
			</p>
			{copied ? <output className="text-primary block text-xs">{t("auth.invitations.copied")}</output> : null}
		</div>
	)
}

function InviteResult({
	copied,
	error,
	invite,
	onCopy,
}: {
	copied: boolean
	error: string | null
	invite: CreateInvitation201 | undefined
	onCopy: (url: string) => void
}) {
	const inviteUrl = invite ? buildInvitationUrl(window.location.origin, invite.token) : null
	return (
		<>
			{error ? (
				<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
					{error}
				</p>
			) : null}
			{invite && inviteUrl ? (
				<InvitationLinkPanel
					copied={copied}
					expiresAt={invite.expiresAt}
					onCopy={() => onCopy(inviteUrl)}
					url={inviteUrl}
				/>
			) : null}
		</>
	)
}

function InviteMemberDialog({ held }: { held: ReadonlyArray<string> }) {
	const { t } = useTranslation()
	const createInvitation = useCreateInvitation()
	const canAssignRoles = held.includes("roles:manage")
	const rolesQuery = useListRoles({ query: { enabled: canAssignRoles } })
	const [selected, setSelected] = useState<Array<string>>([])
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	function resetInvitation() {
		// A generated link is a one-shot artifact; drop it so the next open starts clean.
		createInvitation.reset()
		setError(null)
		setCopied(false)
	}

	function handleOpenChange(next: boolean) {
		if (createInvitation.isPending) return
		setOpen(next)
		if (next)
			setSelected(
				defaultInviteRoleIds(rolesQuery.data?.data.roles, rolesQuery.data?.data.manageableRoleIds ?? [], held),
			)
		else resetInvitation()
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
	const created = Boolean(invite)

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<FloatingActionButton disabled={canAssignRoles && rolesQuery.isPending} />}>
				<UserPlus />
				{t("auth.invitations.heading")}
			</DialogTrigger>
			<DialogContent closeLabel={t("common.close")} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{t("auth.invitations.heading")}</DialogTitle>
				</DialogHeader>
				{canAssignRoles ? (
					<InviteRolesField
						disabled={createInvitation.isPending || created}
						error={rolesQuery.error}
						held={held}
						manageableRoleIds={rolesQuery.data?.data.manageableRoleIds ?? []}
						onChange={setSelected}
						onRetry={() => void rolesQuery.refetch()}
						roles={rolesQuery.data?.data.roles}
						selected={selected}
					/>
				) : null}
				{selected.length === 0 ? (
					<p className="text-muted-foreground text-xs">{t("auth.invitations.noRoles")}</p>
				) : null}
				<InviteResult copied={copied} error={error} invite={invite} onCopy={(url) => void copyInvitation(url)} />
				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)}>
						{t("team.cancel")}
					</Button>
					<Button type="button" onClick={handleCreate} disabled={createInvitation.isPending || created}>
						{t("auth.invitations.create")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

export function TeamPage() {
	const { t } = useTranslation()
	const held = useGetMyPermissions().data?.data.permissions ?? []

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("team.heading")}
				description={t("team.subheading")}
				actions={held.includes("users:manage") ? <InviteMemberDialog held={held} /> : null}
			/>
			<TeamRolesSwitcher />
			<TeamList held={held} />
		</div>
	)
}
