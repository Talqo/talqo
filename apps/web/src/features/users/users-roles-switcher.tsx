import { useGetMyPermissions } from "@/api/generated/roles/roles"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

const LINK_CLASS =
	"rounded-item focus-visible:ring-ring/50 hover:text-foreground h-control-sm inline-flex items-center px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3"
const ACTIVE_LINK_PROPS = { className: "bg-background text-foreground shadow-sm" }

export function UsersRolesSwitcher() {
	const { t } = useTranslation()
	const canManageRoles = useGetMyPermissions().data?.data.permissions.includes("roles:manage") ?? false

	return (
		<nav
			aria-label={t("users.switcherLabel")}
			className="bg-muted text-muted-foreground rounded-control inline-flex w-fit max-w-full overflow-x-auto p-1"
		>
			<Link
				to="/dashboard/users"
				activeOptions={{ exact: true }}
				activeProps={ACTIVE_LINK_PROPS}
				className={LINK_CLASS}
			>
				{t("users.heading")}
			</Link>
			{canManageRoles && (
				<Link to="/dashboard/users/roles" activeProps={ACTIVE_LINK_PROPS} className={LINK_CLASS}>
					{t("roles.heading")}
				</Link>
			)}
		</nav>
	)
}
