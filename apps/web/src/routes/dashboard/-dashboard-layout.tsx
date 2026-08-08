import { dashboardLanguages, isDashboardLanguage } from "@/lib/languages"
import { useLanguage } from "@/lib/use-language"
import { useTheme } from "@/lib/use-theme"
import { Button } from "@talqo/ui/components/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@talqo/ui/components/select"
import { Link } from "@tanstack/react-router"
import { BarChart3, Bot, LayoutDashboard, Menu, MessageSquare, Moon, Sun, User, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

const navItems = [
	{ to: "/dashboard", icon: LayoutDashboard },
	{ to: "/dashboard/agents", icon: Bot },
	{ to: "/dashboard/widget", icon: MessageSquare },
	{ to: "/dashboard/analytics", icon: BarChart3 },
	{ to: "/dashboard/account", icon: User },
] as const

function navLabel(to: (typeof navItems)[number]["to"], t: (key: string) => string) {
	switch (to) {
		case "/dashboard":
			return t("nav.dashboard")
		case "/dashboard/agents":
			return t("nav.agents")
		case "/dashboard/widget":
			return t("nav.widget")
		case "/dashboard/analytics":
			return t("nav.analytics")
		case "/dashboard/account":
			return t("nav.account")
	}
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
			<SelectTrigger
				className="w-auto justify-center px-4 [&>svg]:hidden"
				aria-label={t("header.language") + ": " + dashboardLanguages[language]}
			>
				{language}
			</SelectTrigger>
			<SelectContent align="end">
				{Object.entries(dashboardLanguages).map(([value, label]) => (
					<SelectItem key={value} value={value} className="py-2.5 pl-3.5">
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
