import { useMyPermissions } from "@/features/permissions/permissions-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { createFileRoute, Link } from "@tanstack/react-router"
import { BarChart3, Bot, MessageSquare, User } from "lucide-react"
import { useTranslation } from "react-i18next"

// Mirrors the layout's route-to-permission mapping.
// Account stays visible for ungranted operators.
const cards = [
	{ to: "/dashboard/agents", icon: Bot, requiresRead: true },
	{ to: "/dashboard/widget", icon: MessageSquare, requiresRead: true },
	{ to: "/dashboard/analytics", icon: BarChart3, requiresRead: true },
	{ to: "/dashboard/account", icon: User, requiresRead: false },
] as const

function cardCopy(to: (typeof cards)[number]["to"], t: (key: string) => string) {
	switch (to) {
		case "/dashboard/agents":
			return { title: t("dashboard.cards.agents.title"), description: t("dashboard.cards.agents.description") }
		case "/dashboard/widget":
			return { title: t("dashboard.cards.widget.title"), description: t("dashboard.cards.widget.description") }
		case "/dashboard/analytics":
			return { title: t("dashboard.cards.analytics.title"), description: t("dashboard.cards.analytics.description") }
		case "/dashboard/account":
			return { title: t("dashboard.cards.account.title"), description: t("dashboard.cards.account.description") }
	}
}

export const Route = createFileRoute("/dashboard/")({
	component: DashboardIndexPage,
})

function DashboardIndexPage() {
	const { t } = useTranslation()
	const { data: permissions } = useMyPermissions()
	const canReadAgents = permissions?.includes("agents:read") ?? false
	const visibleCards = cards.filter((card) => !card.requiresRead || canReadAgents)

	return (
		<div className="mx-auto max-w-5xl space-y-8">
			<div>
				<h1 className="text-foreground text-3xl font-bold">{t("dashboard.heading")}</h1>
				<p className="text-muted-foreground mt-2">{t("dashboard.subheading")}</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{visibleCards.map(({ to, icon: Icon }) => {
					const { title, description } = cardCopy(to, t)
					return (
						<Link key={to} to={to} className="group">
							<Card className="h-full transition-shadow hover:shadow-md">
								<CardHeader>
									<Icon className="text-primary mb-2 size-8" />
									<CardTitle>{title}</CardTitle>
									<CardDescription>{description}</CardDescription>
								</CardHeader>
								<CardContent>
									<span className="text-primary text-sm font-medium group-hover:underline">
										{t("dashboard.openCard", { title })}
									</span>
								</CardContent>
							</Card>
						</Link>
					)
				})}
			</div>
		</div>
	)
}
