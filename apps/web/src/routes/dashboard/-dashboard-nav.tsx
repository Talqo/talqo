import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetSession, useLogout } from "@/api/generated/identity/identity.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { ProblemAlert } from "@/components/problem-alert"
import { Avatar, AvatarFallback } from "@talqo/ui/components/avatar"
import { Button } from "@talqo/ui/components/button"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { Bot, LayoutDashboard, LogOut, MessagesSquare, Settings2, User, Users } from "lucide-react"
import { useTranslation } from "react-i18next"

type NavRequirement = "agentRead" | "statsRead" | "conversationsRead" | "providerManage" | "usersRead"

type NavItem = {
	to:
		| "/dashboard"
		| "/dashboard/agents"
		| "/dashboard/conversations"
		| "/dashboard/team"
		| "/dashboard/ai-configuration"
		| "/dashboard/account"
	icon: typeof LayoutDashboard
	requires?: NavRequirement
}

const navItems: readonly NavItem[] = [
	{ to: "/dashboard", icon: LayoutDashboard, requires: "statsRead" },
	{ to: "/dashboard/agents", icon: Bot, requires: "agentRead" },
	{ to: "/dashboard/conversations", icon: MessagesSquare, requires: "conversationsRead" },
	{ to: "/dashboard/team", icon: Users, requires: "usersRead" },
	{ to: "/dashboard/ai-configuration", icon: Settings2, requires: "providerManage" },
	{ to: "/dashboard/account", icon: User },
]

const navLabels = {
	"/dashboard": "nav.dashboard",
	"/dashboard/agents": "nav.agents",
	"/dashboard/conversations": "nav.conversations",
	"/dashboard/team": "nav.team",
	"/dashboard/ai-configuration": "nav.aiConfiguration",
	"/dashboard/account": "nav.account",
} as const satisfies Record<NavItem["to"], string>

export function allowedNavItems(permissions: string[], agents: { permissions: string[] }[]): readonly NavItem[] {
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

export function NavList({ className, onNavigate }: { className: string; onNavigate: () => void }) {
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

export function AccountFooter() {
	const accountName = useGetSession().data?.data.user?.username ?? "…"

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
