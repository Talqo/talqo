import type { AccessGate } from "@/features/permissions/require-permission"

import { PageSkeleton } from "@/components/page-skeleton"
import { LanguageSelect, ThemeToggle } from "@/components/preferences-controls"
import { ProblemAlert } from "@/components/problem-alert"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { Button } from "@talqo/ui/components/button"
import { Logo } from "@talqo/ui/components/logo"
import { Link, useLocation } from "@tanstack/react-router"
import { Menu, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { AccountFooter, NavList } from "./-dashboard-nav"
import { useAgentDiscoveryRefresh, useDashboardGate } from "./-dashboard-queries"
import { useDashboardHeading } from "./-route-heading"
import { useMobileNavigation } from "./-use-mobile-navigation"

function DashboardContent({
	gate,
	error,
	onRetry,
	children,
}: {
	gate: AccessGate
	error: unknown
	onRetry: () => void
	children: React.ReactNode
}) {
	const { t } = useTranslation()

	if (gate === "open") return children
	if (gate === "pending") {
		return (
			<>
				<output className="sr-only">{t("auth.loading")}</output>
				<PageSkeleton />
			</>
		)
	}
	if (gate === "error") return <ProblemAlert error={error} onRetry={onRetry} />
	return <AccessDenied />
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation()
	const { close, closeAndRestoreFocus, open, panelRef, toggleOpen, toggleRef } = useMobileNavigation()
	const pathname = useLocation({ select: (location) => location.pathname })
	const mainRef = useDashboardHeading(pathname, t("common.appName"))
	const { gate, error, retry } = useDashboardGate()
	useAgentDiscoveryRefresh()

	return (
		<div className="bg-background text-foreground flex min-h-screen">
			<a
				href="#dashboard-main"
				className="bg-background text-foreground ring-ring rounded-control sr-only text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:ring-2"
			>
				{t("header.skipToContent")}
			</a>
			<aside className="border-sidebar-border bg-sidebar sticky top-0 hidden h-dvh w-64 flex-col overflow-y-auto border-r p-4 md:flex">
				<Link
					to="/dashboard"
					className="text-sidebar-foreground rounded-item focus-visible:ring-ring/50 mb-6 flex items-center gap-2 px-3 outline-none select-none focus-visible:ring-3"
				>
					<Logo className="size-7" />
					<span className="text-lg font-semibold tracking-tight">{t("common.appName")}</span>
				</Link>
				<NavList className="flex flex-1 flex-col gap-1" onNavigate={close} />
				<AccountFooter />
			</aside>

			<div className="flex min-h-screen min-w-0 flex-1 flex-col">
				<header className="border-border bg-background sticky top-0 z-20 flex items-center justify-between gap-2 border-b p-4">
					<div className="flex items-center gap-2">
						<Button
							ref={toggleRef}
							variant="ghost"
							size="icon"
							className="md:hidden"
							onClick={toggleOpen}
							aria-label={t("header.toggleNavigation")}
							aria-expanded={open}
							aria-controls="mobile-navigation"
						>
							{open ? <X className="size-5" /> : <Menu className="size-5" />}
						</Button>
						<Link
							to="/dashboard"
							aria-label={t("common.appName")}
							className="rounded-item focus-visible:ring-ring/50 inline-flex outline-none select-none focus-visible:ring-3 md:hidden"
						>
							<Logo className="size-6" />
						</Link>
					</div>
					<div className="flex items-center gap-2">
						<LanguageSelect />
						<ThemeToggle />
					</div>
					{open && (
						<div
							ref={panelRef}
							id="mobile-navigation"
							className="border-border bg-sidebar absolute inset-x-0 top-full z-30 max-h-[calc(100dvh-4.5rem)] overflow-y-auto border-b p-4 shadow-lg md:hidden"
						>
							<NavList className="flex flex-col gap-1" onNavigate={closeAndRestoreFocus} />
							<AccountFooter />
						</div>
					)}
				</header>

				<main
					ref={mainRef}
					id="dashboard-main"
					tabIndex={-1}
					className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 max-md:has-data-[slot=floating-action]:pb-28 md:py-20"
				>
					<DashboardContent gate={gate} error={error} onRetry={retry}>
						{children}
					</DashboardContent>
				</main>
			</div>
		</div>
	)
}
