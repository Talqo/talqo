import { useGetMyPermissions } from "@/api/generated/roles/roles"
import { requirePermission } from "@/features/permissions/require-permission"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@talqo/ui/components/tabs"
import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/users")({
	beforeLoad: requirePermission("users:read"),
	component: UserManagement,
})

function UserManagement() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const pathname = useLocation({ select: (location) => location.pathname })
	const tab = pathname.startsWith("/dashboard/users/roles") ? "roles" : "users"
	const canManageRoles = useGetMyPermissions().data?.data.permissions.includes("roles:manage") ?? false
	return (
		<Tabs
			value={tab}
			onValueChange={(value) => {
				void navigate({ to: value === "roles" ? "/dashboard/users/roles" : "/dashboard/users" })
			}}
			className="mx-auto max-w-3xl"
		>
			<div className="flex flex-col gap-6">
				<TabsList aria-label={t("users.heading")}>
					<TabsTrigger value="users">{t("nav.users")}</TabsTrigger>
					{canManageRoles ? <TabsTrigger value="roles">{t("roles.heading")}</TabsTrigger> : null}
				</TabsList>
				<TabsContent value={tab}>
					<Outlet />
				</TabsContent>
			</div>
		</Tabs>
	)
}
