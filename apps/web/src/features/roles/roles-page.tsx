import { useGetSession } from "@/api/generated/identity/identity.ts"
import {
	useGetMyPermissions,
	useListGrantablePermissions,
	useListRoles,
	useListUsers,
} from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { useAccessError } from "@/features/permissions/use-access-error"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent } from "@talqo/ui/components/card"
import { Plus } from "lucide-react"
import { useTranslation } from "react-i18next"

import { DeleteRoleDialog } from "./delete-role-dialog"
import { PERMISSION_COPY } from "./permission-labels"
import { RoleDialog } from "./role-dialog"
import { holdsAll, losesRoleManagement } from "./role-form"

export function RolesPage() {
	const { t } = useTranslation()
	const rolesQuery = useListRoles()
	const catalogQuery = useListGrantablePermissions()
	const heldQuery = useGetMyPermissions()
	const usersQuery = useListUsers()
	const sessionQuery = useGetSession()
	const sessionUserId = sessionQuery.data?.data.user?.id
	const forbidden = useAccessError(
		rolesQuery.error,
		catalogQuery.error,
		heldQuery.error,
		usersQuery.error,
		sessionQuery.error,
	)
	const pending =
		rolesQuery.isPending ||
		catalogQuery.isPending ||
		heldQuery.isPending ||
		usersQuery.isPending ||
		sessionQuery.isPending
	const failed =
		rolesQuery.isError || catalogQuery.isError || heldQuery.isError || usersQuery.isError || sessionQuery.isError

	const catalog = catalogQuery.data?.data.permissions
	const held = heldQuery.data?.data.permissions
	const roles = rolesQuery.data?.data.roles ?? []
	const ownRoleIds = new Set(
		usersQuery.data?.data.users.find(({ id }) => id === sessionUserId)?.roles.map(({ id }) => id) ?? [],
	)
	const ownRoles = roles.filter(({ id }) => ownRoleIds.has(id))
	const header = (
		<PageHeader
			title={t("roles.heading")}
			description={t("roles.subheading")}
			actions={
				!pending && !failed && catalog && held ? (
					<RoleDialog
						catalog={catalog}
						heldPermissions={held}
						ownRoles={ownRoles}
						trigger={
							<Button>
								<Plus className="size-4" />
								{t("roles.create")}
							</Button>
						}
					/>
				) : null
			}
		/>
	)

	let body: React.ReactNode
	if (pending) {
		body = <p className="text-muted-foreground">{t("roles.loading")}</p>
	} else if (forbidden) {
		body = <AccessDenied />
	} else if (failed || !rolesQuery.data || !catalog || !held) {
		body = (
			<Card>
				<CardContent>
					<p className="text-muted-foreground text-sm">{t("auth.errorFallback")}</p>
				</CardContent>
			</Card>
		)
	} else if (roles.length === 0) {
		body = <p className="text-muted-foreground">{t("roles.empty")}</p>
	} else {
		body = (
			<Card>
				<CardContent className="divide-y">
					{roles.map((role) => {
						const summary = role.permissions.map((permission) => PERMISSION_COPY[permission].label(t)).join(", ")
						const changeable = holdsAll(held, role.permissions)
						return (
							<div
								key={role.id}
								data-role-id={role.id}
								className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
							>
								<div className="min-w-0 space-y-1">
									<p className="font-medium break-words">{role.name}</p>
									<p className="text-muted-foreground text-sm">{summary || t("roles.noAccess")}</p>
									<p className="text-muted-foreground text-xs">{t("roles.members", { people: role.memberCount })}</p>
								</div>
								{changeable ? (
									<div className="flex items-center gap-3">
										<RoleDialog
											catalog={catalog}
											heldPermissions={held}
											ownRoles={ownRoles}
											role={role}
											trigger={<Button variant="outline">{t("roles.edit")}</Button>}
										/>
										<DeleteRoleDialog
											role={role}
											locksOut={losesRoleManagement({
												heldPermissions: held,
												rolesBefore: ownRoles,
												rolesAfter: ownRoles.filter(({ id }) => id !== role.id),
											})}
										/>
									</div>
								) : (
									<p className="text-muted-foreground max-w-xs text-xs">{t("roles.cannotChange")}</p>
								)}
							</div>
						)
					})}
				</CardContent>
			</Card>
		)
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			{header}
			{body}
		</div>
	)
}
