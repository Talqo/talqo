import { useGetSession } from "@/api/generated/identity/identity"
import {
	useGetMyPermissions,
	useListGrantablePermissions,
	useListRoles,
	useListUsers,
} from "@/api/generated/roles/roles"
import { PageHeader } from "@/components/page-header"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { useAccessError } from "@/features/permissions/use-access-error"
import { buttonVariants } from "@talqo/ui/components/button"
import { Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

import { holdsAll } from "./role-form"
import { UpdateRoleForm } from "./update-role-form"

export function RolePage({ roleId }: { roleId: string }) {
	const { t } = useTranslation()
	const rolesQuery = useListRoles()
	const catalogQuery = useListGrantablePermissions()
	const heldQuery = useGetMyPermissions()
	const usersQuery = useListUsers()
	const sessionQuery = useGetSession()
	const queries = [rolesQuery, catalogQuery, heldQuery, usersQuery, sessionQuery]
	const forbidden = useAccessError(...queries.map(({ error }) => error))
	const roles = rolesQuery.data?.data.roles
	const role = roles?.find(({ id }) => id === roleId)
	const catalog = catalogQuery.data?.data.permissions
	const held = heldQuery.data?.data.permissions
	const ownRoleIds = new Set(
		usersQuery.data?.data.users.find(({ id }) => id === sessionQuery.data?.data.user?.id)?.roles.map(({ id }) => id) ??
			[],
	)
	const ownRoles = roles?.filter(({ id }) => ownRoleIds.has(id)) ?? []
	const changeable = role && held && holdsAll(held, role.permissions)

	return (
		<div className="space-y-6">
			<Link to="/dashboard/users/roles" className={buttonVariants({ variant: "ghost", className: "-ml-2" })}>
				<ArrowLeft className="size-4" />
				{t("roles.back")}
			</Link>
			{forbidden ? (
				<AccessDenied />
			) : queries.some(({ isPending }) => isPending) ? (
				<p className="text-muted-foreground">{t("roles.loading")}</p>
			) : queries.some(({ isError }) => isError) || !roles || !catalog || !held ? (
				<p role="alert" className="text-destructive text-sm">
					{t("auth.errorFallback")}
				</p>
			) : !role ? (
				<p role="alert" className="text-muted-foreground">
					{t("problems.role-not-found")}
				</p>
			) : (
				<>
					<PageHeader title={role.name} description={t("roles.settingsDescription")} />
					{!changeable ? <p className="text-muted-foreground text-sm">{t("roles.cannotChange")}</p> : null}
					<UpdateRoleForm
						role={role}
						catalog={catalog}
						heldPermissions={held}
						ownRoles={ownRoles}
						disabled={!changeable}
					/>
				</>
			)}
		</div>
	)
}
