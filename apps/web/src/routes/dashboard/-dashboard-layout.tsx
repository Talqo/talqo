import { useGetSession, useLogout } from "@/api/generated/identity/identity.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { LanguageSelect, ThemeToggle } from "@/components/preferences-controls"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { accessGate, useRequiredPermission } from "@/features/permissions/require-permission"
import { Button } from "@talqo/ui/components/button"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { Bot, LayoutDashboard, LogOut, Menu, Settings2, User, Users, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

type NavRequirement = "admin" | "agentRead" | "providerManage"

type NavItem = {
	to: "/dashboard" | "/dashboard/agents" | "/dashboard/users" | "/dashboard/ai-configuration" | "/dashboard/account"
	icon: typeof LayoutDashboard
	requires?: NavRequirement
}

const navItems: readonly NavItem[] = [
	{ to: "/dashboard", icon: LayoutDashboard, requires: "agentRead" },
	{ to: "/dashboard/agents", icon: Bot, requires: "agentRead" },
	{ to: "/dashboard/users", icon: Users, requires: "admin" },
	{ to: "/dashboard/ai-configuration", icon: Settings2, requires: "providerManage" },
	{ to: "/dashboard/account", icon: User },
]

const navLabels = {
	"/dashboard": "nav.dashboard",
	"/dashboard/agents": "nav.agents",
	"/dashboard/users": "nav.users",
	"/dashboard/ai-configuration": "nav.aiConfiguration",
	"/dashboard/account": "nav.account",
} as const satisfies Record<NavItem["to"], string>

function allowedNavItems(permissions: string[] | undefined): readonly NavItem[] {
	const canReadAgents = permissions?.includes("agents:read") ?? false
	const canManageProvider = permissions?.includes("ai_provider:manage") ?? false
	const isAdmin = permissions?.includes("admin") ?? false
	return navItems.filter((item) => {
		if (item.requires === "agentRead") return canReadAgents
		if (item.requires === "providerManage") return canManageProvider
		if (item.requires === "admin") return isAdmin
		return true
	})
}

function NavLink({ item, onNavigate }: { item: (typeof navItems)[number]; onNavigate: () => void }) {
	const { t } = useTranslation()
	const Icon = item.icon
	return (
		<Link
			to={item.to}
			activeOptions={{ exact: item.to === "/dashboard", includeSearch: false }}
			activeProps={{
				className: "bg-sidebar-primary text-sidebar-primary-foreground",
			}}
			inactiveProps={{
				className: "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
			}}
			className="min-h-control rounded-item flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors"
			onClick={onNavigate}
		>
			<Icon className="size-5" />
			{t(navLabels[item.to])}
		</Link>
	)
}

function NavList({
	className,
	onNavigate,
	permissions,
}: {
	className: string
	onNavigate: () => void
	permissions: string[] | undefined
}) {
	const items = allowedNavItems(permissions)
	return (
		<nav className={className}>
			{items.map((item) => (
				<NavLink key={item.to} item={item} onNavigate={onNavigate} />
			))}
		</nav>
	)
}

function LogoutButton() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const logout = useLogout()

	async function handleLogout() {
		await logout.mutateAsync()
		queryClient.clear()
		await navigate({ to: "/login" })
	}

	return (
		<Button variant="ghost" onClick={handleLogout} disabled={logout.isPending}>
			<LogOut className="size-4" />
			{t("header.logout")}
		</Button>
	)
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation()
	const [mobileOpen, setMobileOpen] = useState(false)
	const closeMobile = () => setMobileOpen(false)
	const accountName = useGetSession().data?.data.user?.username ?? "…"
	const permissionsQuery = useGetMyPermissions()
	const permissions = permissionsQuery.data?.data.permissions
	// Children stay unmounted until the gate opens, so a denied caller fires no queries.
	const gate = accessGate(useRequiredPermission(), permissionsQuery)

	return (
		<div className="bg-background text-foreground flex min-h-screen">
			<aside className="border-sidebar-border bg-sidebar sticky top-0 hidden h-dvh w-64 flex-col overflow-y-auto border-r p-4 md:flex">
				<div className="text-sidebar-foreground mb-6 truncate px-3 text-sm font-semibold">{accountName}</div>
				<NavList className="flex flex-1 flex-col gap-1" onNavigate={closeMobile} permissions={permissions} />
			</aside>

			<div className="flex min-h-screen flex-1 flex-col">
				<header className="border-border bg-background sticky top-0 z-20 flex items-center justify-between gap-2 border-b p-4">
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="icon"
							className="md:hidden"
							onClick={() => setMobileOpen((open) => !open)}
							aria-label={t("header.toggleNavigation")}
						>
							{mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
						</Button>
						<span className="truncate text-sm font-semibold md:hidden">{accountName}</span>
					</div>
					<div className="flex items-center gap-2">
						<LanguageSelect />
						<ThemeToggle />
						<LogoutButton />
					</div>
				</header>
				{mobileOpen && (
					<NavList
						className="border-border bg-sidebar flex flex-col gap-1 border-b p-4 md:hidden"
						onNavigate={closeMobile}
						permissions={permissions}
					/>
				)}

				<main className="flex-1 p-6">
					{gate === "open" && children}
					{gate === "pending" && <p className="text-muted-foreground">{t("auth.loading")}</p>}
					{gate === "error" && <p className="text-muted-foreground">{t("auth.errorFallback")}</p>}
					{gate === "denied" && <AccessDenied />}
				</main>
			</div>
		</div>
	)
}
