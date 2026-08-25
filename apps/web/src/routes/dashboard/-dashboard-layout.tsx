import { useLogout } from "@/api/generated/identity/identity.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { LanguageSelect, ThemeToggle } from "@/components/preferences-controls"
import { Button } from "@talqo/ui/components/button"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
	BarChart3,
	Bot,
	LayoutDashboard,
	LogOut,
	Menu,
	MessageSquare,
	Settings2,
	User,
	UserPlus,
	X,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

type NavRequirement = "agentRead" | "invite" | "providerManage"

type NavItem = {
	to:
		| "/dashboard"
		| "/dashboard/agents"
		| "/dashboard/invitations"
		| "/dashboard/widget"
		| "/dashboard/analytics"
		| "/dashboard/ai-configuration"
		| "/dashboard/account"
	icon: typeof LayoutDashboard
	requires?: NavRequirement
}

const navItems: readonly NavItem[] = [
	{ to: "/dashboard", icon: LayoutDashboard },
	{ to: "/dashboard/agents", icon: Bot, requires: "agentRead" },
	{ to: "/dashboard/invitations", icon: UserPlus, requires: "invite" },
	{ to: "/dashboard/widget", icon: MessageSquare, requires: "agentRead" },
	{ to: "/dashboard/analytics", icon: BarChart3, requires: "agentRead" },
	{ to: "/dashboard/ai-configuration", icon: Settings2, requires: "providerManage" },
	{ to: "/dashboard/account", icon: User },
]

function navLabel(to: (typeof navItems)[number]["to"], t: (key: string) => string) {
	switch (to) {
		case "/dashboard":
			return t("nav.dashboard")
		case "/dashboard/agents":
			return t("nav.agents")
		case "/dashboard/invitations":
			return t("nav.invitations")
		case "/dashboard/widget":
			return t("nav.widget")
		case "/dashboard/analytics":
			return t("nav.analytics")
		case "/dashboard/ai-configuration":
			return t("nav.aiConfiguration")
		case "/dashboard/account":
			return t("nav.account")
	}
}

function allowedNavItems(permissions: string[] | undefined): readonly NavItem[] {
	const canReadAgents = permissions?.includes("agents:read") ?? false
	const canInvite = permissions?.includes("users:invite") ?? false
	const canManageProvider = permissions?.includes("ai_provider:manage") ?? false
	return navItems.filter((item) => {
		if (item.requires === "agentRead") return canReadAgents
		if (item.requires === "invite") return canInvite
		if (item.requires === "providerManage") return canManageProvider
		return true
	})
}

function NavLink({ to, icon: Icon, onNavigate }: (typeof navItems)[number] & { onNavigate: () => void }) {
	const { t } = useTranslation()
	return (
		<Link
			to={to}
			activeOptions={{ exact: to === "/dashboard" }}
			activeProps={{
				className: "bg-sidebar-primary text-sidebar-primary-foreground",
			}}
			inactiveProps={{
				className: "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
			}}
			className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
			onClick={onNavigate}
		>
			<Icon className="size-5" />
			{navLabel(to, t)}
		</Link>
	)
}

function NavList({ className, onNavigate }: { className: string; onNavigate: () => void }) {
	const permissions = useGetMyPermissions().data?.data.permissions
	const items = allowedNavItems(permissions)
	return (
		<nav className={className}>
			{items.map((item) => (
				<NavLink key={item.to} {...item} onNavigate={onNavigate} />
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
		<Button variant="ghost" size="sm" onClick={handleLogout} disabled={logout.isPending}>
			<LogOut className="size-4" />
			{t("header.logout")}
		</Button>
	)
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation()
	const [mobileOpen, setMobileOpen] = useState(false)
	const closeMobile = () => setMobileOpen(false)

	return (
		<div className="bg-background text-foreground flex min-h-screen">
			<aside className="border-sidebar-border bg-sidebar sticky top-0 hidden h-dvh w-64 flex-col overflow-y-auto border-r p-4 md:flex">
				<div className="text-sidebar-foreground mb-6 truncate px-3 text-sm font-semibold">
					{t("header.placeholderName")}
				</div>
				<NavList className="flex flex-1 flex-col gap-1" onNavigate={closeMobile} />
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
						<span className="truncate text-sm font-semibold md:hidden">{t("header.placeholderName")}</span>
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
					/>
				)}

				<main className="flex-1 p-6">{children}</main>
			</div>
		</div>
	)
}
