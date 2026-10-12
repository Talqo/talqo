import { useGetSession } from "@/api/generated/identity/identity.ts"
import {
	useGetMyPermissions,
	useListGrantablePermissions,
	useListRoles,
	useListUsers,
} from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent } from "@talqo/ui/components/card"
import { useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { DeleteRoleDialog } from "./delete-role-dialog"
import { PERMISSION_COPY } from "./permission-labels"
import { RoleDialog } from "./role-dialog"
import { explicitPermissions, holdsAll, losesRoleManagement } from "./role-form"

const FORBIDDEN_STATUS = 403
const UNAUTHORIZED_STATUS = 401

function errorStatus(error: unknown): number | undefined {
	return (error as { status?: number } | null)?.status
}

export function RolesPage() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const rolesQuery = useListRoles()
	const catalogQuery = useListGrantablePermissions()
	const heldQuery = useGetMyPermissions()
	// Only for the self-lockout warning; until it loads, no warning shows.
	const usersQuery = useListUsers()
	const sessionUserId = useGetSession().data?.data.user?.id
	const status = errorStatus(rolesQuery.error) ?? errorStatus(catalogQuery.error)

	useEffect(() => {
		if (status === UNAUTHORIZED_STATUS) void navigate({ to: "/login" })
	}, [status, navigate])

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
				catalog && held ? (
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
	if (rolesQuery.isPending || catalogQuery.isPending || heldQuery.isPending) {
		body = <p className="text-muted-foreground">{t("roles.loading")}</p>
	} else if (status === FORBIDDEN_STATUS) {
		// A role removed while the page is open still lands here.
		body = <AccessDenied />
	} else if (!rolesQuery.data || !catalog || !held) {
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
			<div className="space-y-3">
				{roles.map((role) => {
					const summary = explicitPermissions(role.permissions, catalog)
						.map((permission) => PERMISSION_COPY[permission].label(t))
						.join(", ")
					const changeable = holdsAll(held, role.permissions)
					return (
						<Card key={role.id} data-role-id={role.id}>
							<CardContent className="flex flex-wrap items-center justify-between gap-4">
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
							</CardContent>
						</Card>
					)
				})}
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			{header}
			{body}
		</div>
	)
}
