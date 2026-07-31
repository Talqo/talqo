import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { createFileRoute, Link } from "@tanstack/react-router"
import { BarChart3, Bot, MessageSquare, User } from "lucide-react"
import { useTranslation } from "react-i18next"

const cards = [
	{
		to: "/dashboard/bots",
		titleKey: "dashboard.cards.bots.title",
		descriptionKey: "dashboard.cards.bots.description",
		icon: Bot,
	},
	{
		to: "/dashboard/widget",
		titleKey: "dashboard.cards.widget.title",
		descriptionKey: "dashboard.cards.widget.description",
		icon: MessageSquare,
	},
	{
		to: "/dashboard/analytics",
		titleKey: "dashboard.cards.analytics.title",
		descriptionKey: "dashboard.cards.analytics.description",
		icon: BarChart3,
	},
	{
		to: "/dashboard/account",
		titleKey: "dashboard.cards.account.title",
		descriptionKey: "dashboard.cards.account.description",
		icon: User,
	},
] as const

export const Route = createFileRoute("/dashboard/")({
	component: DashboardIndexPage,
})

function DashboardIndexPage() {
	const { t } = useTranslation()
	return (
		<div className="mx-auto max-w-5xl space-y-8">
			<div>
				<h1 className="font-bold text-3xl text-foreground">{t("dashboard.heading")}</h1>
				<p className="mt-2 text-muted-foreground">{t("dashboard.subheading")}</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{cards.map(({ to, titleKey, descriptionKey, icon: Icon }) => {
					const title = t(titleKey)
					return (
						<Link key={to} to={to} className="group">
							<Card className="h-full transition-shadow hover:shadow-md">
								<CardHeader>
									<Icon className="mb-2 size-8 text-primary" />
									<CardTitle>{title}</CardTitle>
									<CardDescription>{t(descriptionKey)}</CardDescription>
								</CardHeader>
								<CardContent>
									<span className="font-medium text-primary text-sm group-hover:underline">
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
