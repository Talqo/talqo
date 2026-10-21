import { getListAgentsQueryKey, useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetSession, useLogout } from "@/api/generated/identity/identity.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { LanguageSelect, ThemeToggle } from "@/components/preferences-controls"
import { ProblemAlert } from "@/components/problem-alert"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { accessGate, useRequiredPermission } from "@/features/permissions/require-permission"
import { Button } from "@talqo/ui/components/button"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import { Bot, LayoutDashboard, LogOut, Menu, MessagesSquare, Settings2, User, Users, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

type NavRequirement = "agentRead" | "statsRead" | "conversationsRead" | "providerManage" | "usersRead"

type NavItem = {
	to:
		| "/dashboard"
		| "/dashboard/agents"
		| "/dashboard/conversations"
		| "/dashboard/users"
		| "/dashboard/ai-configuration"
		| "/dashboard/account"
	icon: typeof LayoutDashboard
	requires?: NavRequirement
}

const navItems: readonly NavItem[] = [
	{ to: "/dashboard", icon: LayoutDashboard, requires: "statsRead" },
	{ to: "/dashboard/agents", icon: Bot, requires: "agentRead" },
	{ to: "/dashboard/conversations", icon: MessagesSquare, requires: "conversationsRead" },
	{ to: "/dashboard/users", icon: Users, requires: "usersRead" },
	{ to: "/dashboard/ai-configuration", icon: Settings2, requires: "providerManage" },
	{ to: "/dashboard/account", icon: User },
]

const navLabels = {
	"/dashboard": "nav.dashboard",
	"/dashboard/agents": "nav.agents",
	"/dashboard/conversations": "nav.conversations",
	"/dashboard/users": "nav.users",
	"/dashboard/ai-configuration": "nav.aiConfiguration",
	"/dashboard/account": "nav.account",
} as const satisfies Record<NavItem["to"], string>

function allowedNavItems(permissions: string[], agents: { permissions: string[] }[]): readonly NavItem[] {
	const admin = permissions.includes("admin")
	const canReadAgents = admin || agents.some((agent) => agent.permissions.includes("agents:read"))
	const canReadConversations = admin || agents.some((agent) => agent.permissions.includes("conversations:read"))
	const canReadStats = admin || agents.some((agent) => agent.permissions.includes("stats:read"))
	const canManageProvider = permissions.includes("ai_provider:manage")
	const canReadUsers = permissions.includes("users:read")
	return navItems.filter((item) => {
		if (item.requires === "agentRead") return canReadAgents
		if (item.requires === "statsRead") return canReadStats
		if (item.requires === "conversationsRead") return canReadConversations
		if (item.requires === "providerManage") return canManageProvider
		if (item.requires === "usersRead") return canReadUsers
		return true
	})
}

function NavLink({ item, onNavigate }: { item: (typeof navItems)[number]; onNavigate: () => void }) {
	const { t } = useTranslation()
	const Icon = item.icon
	// Search params (the statistics filters) must not deactivate a nav item.
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

function NavList({ className, onNavigate }: { className: string; onNavigate: () => void }) {
	const { t } = useTranslation()
	const query = useGetMyPermissions()
	const agentsQuery = useListAgents()
	return (
		<nav className={className}>
			{query.isPending || agentsQuery.isPending ? (
				<output className="text-muted-foreground block px-3 text-sm">{t("auth.loading")}</output>
			) : query.isError || agentsQuery.isError ? (
				<ProblemAlert
					error={query.error ?? agentsQuery.error}
					onRetry={() => {
						void query.refetch()
						void agentsQuery.refetch()
					}}
				/>
			) : (
				allowedNavItems(query.data.data.permissions, agentsQuery.data?.data.agents ?? []).map((item) => (
					<NavLink key={item.to} item={item} onNavigate={onNavigate} />
				))
			)}
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
	const agentsQuery = useListAgents()
	// Children stay unmounted until the gate opens, so a denied caller fires no queries.
	const gate = accessGate(useRequiredPermission(), permissionsQuery, agentsQuery)
	const navigate = useNavigate()
	const client = useQueryClient()
	const router = useRouter()
	useEffect(
		() =>
			router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
				if (fromLocation?.pathname !== toLocation.pathname)
					void client.invalidateQueries({ queryKey: getListAgentsQueryKey() })
			}),
		[router, client],
	)
	useEffect(() => {
		if (gate === "denied" && permissionsQuery.data && agentsQuery.data) {
			const destination =
				allowedNavItems(permissionsQuery.data.data.permissions, agentsQuery.data.data.agents)[0]?.to ??
				"/dashboard/account"
			void navigate({ to: destination, replace: true })
		}
	}, [gate, permissionsQuery.data, agentsQuery.data, navigate])

	return (
		<div className="bg-background text-foreground flex min-h-screen">
			<aside className="border-sidebar-border bg-sidebar sticky top-0 hidden h-dvh w-64 flex-col overflow-y-auto border-r p-4 md:flex">
				<div className="text-sidebar-foreground mb-6 truncate px-3 text-sm font-semibold">{accountName}</div>
				<NavList className="flex flex-1 flex-col gap-1" onNavigate={closeMobile} />
			</aside>

			<div className="flex min-h-screen min-w-0 flex-1 flex-col">
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
					/>
				)}

				<main className="flex-1 p-6">
					{gate === "open" && children}
					{gate === "pending" && <p className="text-muted-foreground">{t("auth.loading")}</p>}
					{gate === "error" && (
						<ProblemAlert
							error={permissionsQuery.error ?? agentsQuery.error}
							onRetry={() => {
								void permissionsQuery.refetch()
								void agentsQuery.refetch()
							}}
						/>
					)}
					{gate === "denied" && <AccessDenied />}
				</main>
			</div>
		</div>
	)
}
