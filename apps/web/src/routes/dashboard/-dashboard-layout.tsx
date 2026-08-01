import { dashboardLanguages, isDashboardLanguage } from "@/lib/languages"
import { useLanguage } from "@/lib/use-language"
import { useTheme } from "@/lib/use-theme"
import { Button } from "@talqo/ui/components/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Link } from "@tanstack/react-router"
import { BarChart3, Bot, LayoutDashboard, Menu, MessageSquare, Moon, Sun, User, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

// Placeholder until real account data is wired up; shown in the desktop
// sidebar and the mobile header.
const accountName = "Account name"

const navItems = [
	{ to: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
	{ to: "/dashboard/agents", labelKey: "nav.agents", icon: Bot },
	{ to: "/dashboard/widget", labelKey: "nav.widget", icon: MessageSquare },
	{ to: "/dashboard/analytics", labelKey: "nav.analytics", icon: BarChart3 },
	{ to: "/dashboard/account", labelKey: "nav.account", icon: User },
] as const

function NavLink({ to, labelKey, icon: Icon, onNavigate }: (typeof navItems)[number] & { onNavigate: () => void }) {
	const { t } = useTranslation()
	return (
		<Link
			to={to}
			// The index route must match exactly, otherwise every sub-page would
			// highlight "Dashboard" as well.
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
			{t(labelKey)}
		</Link>
	)
}

function NavList({ className, onNavigate }: { className: string; onNavigate: () => void }) {
	return (
		<nav className={className}>
			{navItems.map((item) => (
				<NavLink key={item.to} {...item} onNavigate={onNavigate} />
			))}
		</nav>
	)
}

function ThemeToggle() {
	const { t } = useTranslation()
	const { theme, toggleTheme } = useTheme()
	return (
		<Button
			variant="ghost"
			size="icon"
			onClick={toggleTheme}
			aria-label={theme === "dark" ? t("header.toLightTheme") : t("header.toDarkTheme")}
		>
			{theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
		</Button>
	)
}

function LanguageSelect() {
	const { t } = useTranslation()
	const { language, setLanguage } = useLanguage()
	return (
		<Select
			value={language}
			onValueChange={(value) => {
				if (isDashboardLanguage(value)) {
					setLanguage(value)
				}
			}}
		>
			<SelectTrigger className="w-32" aria-label={t("header.language")}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{Object.entries(dashboardLanguages).map(([value, label]) => (
					<SelectItem key={value} value={value}>
						{label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation()
	const [mobileOpen, setMobileOpen] = useState(false)
	const closeMobile = () => setMobileOpen(false)

	return (
		<div className="bg-background text-foreground flex min-h-screen">
			{/* Desktop sidebar */}
			<aside className="border-sidebar-border bg-sidebar sticky top-0 hidden h-dvh w-64 flex-col overflow-y-auto border-r p-4 md:flex">
				<div className="text-sidebar-foreground mb-6 truncate px-3 text-sm font-semibold">{accountName}</div>
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
						<span className="truncate text-sm font-semibold md:hidden">{accountName}</span>
					</div>
					<div className="flex items-center gap-2">
						<LanguageSelect />
						<ThemeToggle />
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
