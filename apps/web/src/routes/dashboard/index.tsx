import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { createFileRoute, Link } from "@tanstack/react-router"
import { BarChart3, Bot, User } from "lucide-react"
import { useTranslation } from "react-i18next"

const cards = [
	{ to: "/dashboard/agents", icon: Bot, requiresRead: true },
	{ to: "/dashboard/analytics", icon: BarChart3, requiresRead: true },
	{ to: "/dashboard/account", icon: User, requiresRead: false },
] as const

const cardKeys = {
	"/dashboard/agents": "agents",
	"/dashboard/analytics": "analytics",
	"/dashboard/account": "account",
} as const satisfies Record<(typeof cards)[number]["to"], string>

export const Route = createFileRoute("/dashboard/")({
	component: DashboardIndexPage,
})

function DashboardIndexPage() {
	const { t } = useTranslation()
	const permissions = useGetMyPermissions().data?.data.permissions
	const canReadAgents = permissions?.includes("agents:read") ?? false
	const visibleCards = cards.filter((card) => !card.requiresRead || canReadAgents)

	return (
		<div className="mx-auto max-w-5xl space-y-8">
			<div>
				<h1 className="text-foreground text-3xl font-bold">{t("dashboard.heading")}</h1>
				<p className="text-muted-foreground mt-2">{t("dashboard.subheading")}</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{visibleCards.map((card) => {
					const title = t(`dashboard.cards.${cardKeys[card.to]}.title`)
					const Icon = card.icon
					return (
						<Link key={card.to} to={card.to} className="group">
							<Card className="h-full transition-shadow hover:shadow-md">
								<CardHeader>
									<Icon className="text-primary mb-2 size-8" />
									<CardTitle>{title}</CardTitle>
									<CardDescription>{t(`dashboard.cards.${cardKeys[card.to]}.description`)}</CardDescription>
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
