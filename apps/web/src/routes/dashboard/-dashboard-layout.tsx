import { getListAgentsQueryKey, useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetSession, useLogout } from "@/api/generated/identity/identity.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { PageSkeleton } from "@/components/page-skeleton"
import { LanguageSelect, ThemeToggle } from "@/components/preferences-controls"
import { ProblemAlert } from "@/components/problem-alert"
import { clearAgentContent } from "@/features/permissions/clear-agent-content"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { accessGate, useRequiredPermission } from "@/features/permissions/require-permission"
import { Avatar, AvatarFallback } from "@talqo/ui/components/avatar"
import { Button } from "@talqo/ui/components/button"
import { DialogCloseLabelProvider } from "@talqo/ui/components/dialog"
import { Logo } from "@talqo/ui/components/logo"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router"
import { Bot, LayoutDashboard, LogOut, Menu, MessagesSquare, Settings2, User, Users, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { useRouteHeading } from "./-route-heading"

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
				<div className="space-y-1 px-3">
					<output className="sr-only">{t("auth.loading")}</output>
					{Array.from({ length: 5 }, (_, index) => (
						<Skeleton key={index} className="h-9 w-full" />
					))}
				</div>
			) : (
				allowedNavItems(
					query.data?.data.permissions ?? [],
					agentsQuery.isSuccess ? agentsQuery.data.data.agents : [],
				).map((item) => <NavLink key={item.to} item={item} onNavigate={onNavigate} />)
			)}
			{(query.isError || agentsQuery.isError) && (
				<ProblemAlert
					error={query.error ?? agentsQuery.error}
					onRetry={() => {
						void query.refetch()
						void agentsQuery.refetch()
					}}
				/>
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
		<Button variant="ghost" className="w-full justify-start" onClick={handleLogout} disabled={logout.isPending}>
			<LogOut className="size-4" />
			{t("header.logout")}
		</Button>
	)
}

function AccountFooter({ accountName }: { accountName: string }) {
	return (
		<div className="border-sidebar-border mt-4 flex flex-col gap-1 border-t pt-3">
			<div className="text-sidebar-foreground flex min-w-0 items-center gap-2 px-3 py-1.5">
				<Avatar aria-hidden>
					<AvatarFallback>{accountName.slice(0, 1).toUpperCase()}</AvatarFallback>
				</Avatar>
				<span className="truncate text-sm font-medium">{accountName}</span>
			</div>
			<LogoutButton />
		</div>
	)
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation()
	const [mobileOpen, setMobileOpen] = useState(false)
	const toggleRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const mainRef = useRef<HTMLElement>(null)
	const pathname = useLocation({ select: (location) => location.pathname })
	const closeMobile = () => setMobileOpen(false)
	const closeMobileAndRestoreFocus = useCallback(() => {
		setMobileOpen(false)
		toggleRef.current?.focus()
	}, [])
	useRouteHeading(pathname, mainRef, t("common.appName"))
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
				setMobileOpen(false)
				if (fromLocation?.pathname === toLocation.pathname) return
				void client.invalidateQueries({ queryKey: getListAgentsQueryKey() })
			}),
		[router, client],
	)
	useEffect(() => {
		if (gate === "denied" && permissionsQuery.data && agentsQuery.data) {
			clearAgentContent(client)
			const destination =
				allowedNavItems(permissionsQuery.data.data.permissions, agentsQuery.data.data.agents)[0]?.to ??
				"/dashboard/account"
			void navigate({ to: destination, replace: true })
		}
	}, [gate, permissionsQuery.data, agentsQuery.data, navigate, client])

	useEffect(() => {
		if (!mobileOpen) return undefined
		panelRef.current?.querySelector<HTMLElement>("a, button")?.focus()

		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return
			event.stopPropagation()
			closeMobileAndRestoreFocus()
		}
		function onPointerDown(event: PointerEvent) {
			const target = event.target
			if (!(target instanceof Node)) return
			if (panelRef.current?.contains(target) || toggleRef.current?.contains(target)) return
			closeMobileAndRestoreFocus()
		}
		document.addEventListener("keydown", onKeyDown)
		document.addEventListener("pointerdown", onPointerDown)
		return () => {
			document.removeEventListener("keydown", onKeyDown)
			document.removeEventListener("pointerdown", onPointerDown)
		}
	}, [mobileOpen, closeMobileAndRestoreFocus])

	return (
		<div className="bg-background text-foreground flex min-h-screen">
			<a
				href="#dashboard-main"
				className="bg-background text-foreground ring-ring rounded-control sr-only text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:ring-2"
			>
				{t("header.skipToContent")}
			</a>
			<aside className="border-sidebar-border bg-sidebar sticky top-0 hidden h-dvh w-64 flex-col overflow-y-auto border-r p-4 md:flex">
				<div className="text-sidebar-foreground mb-6 flex items-center gap-2 px-3">
					<Logo className="size-7" />
					<span className="text-lg font-semibold tracking-tight">{t("common.appName")}</span>
				</div>
				<NavList className="flex flex-1 flex-col gap-1" onNavigate={closeMobile} />
				<AccountFooter accountName={accountName} />
			</aside>

			<div className="flex min-h-screen min-w-0 flex-1 flex-col">
				<header className="border-border bg-background sticky top-0 z-20 flex items-center justify-between gap-2 border-b p-4">
					<div className="flex items-center gap-2">
						<Button
							ref={toggleRef}
							variant="ghost"
							size="icon"
							className="md:hidden"
							onClick={() => setMobileOpen((open) => !open)}
							aria-label={t("header.toggleNavigation")}
							aria-expanded={mobileOpen}
							aria-controls="mobile-navigation"
						>
							{mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
						</Button>
						<Logo className="size-6 md:hidden" />
					</div>
					<div className="flex items-center gap-2">
						<LanguageSelect />
						<ThemeToggle />
					</div>
					{mobileOpen && (
						<div
							ref={panelRef}
							id="mobile-navigation"
							className="border-border bg-sidebar absolute inset-x-0 top-full z-30 max-h-[calc(100dvh-4.5rem)] overflow-y-auto border-b p-4 shadow-lg md:hidden"
						>
							<NavList className="flex flex-col gap-1" onNavigate={closeMobile} />
							<AccountFooter accountName={accountName} />
						</div>
					)}
				</header>

				<main
					ref={mainRef}
					id="dashboard-main"
					tabIndex={-1}
					className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 md:py-20"
				>
					{gate === "open" && children}
					{gate === "pending" && (
						<>
							<output className="sr-only">{t("auth.loading")}</output>
							<PageSkeleton />
						</>
					)}
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
