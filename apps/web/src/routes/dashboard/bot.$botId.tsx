import { PageHeader } from "@/components/page-header"
import { parseBlacklist } from "@/features/widgets/blacklist"
import { useUpdateWidget, useWidget } from "@/features/widgets/widgets-query"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Switch } from "@talqo/ui/components/switch"
import { Textarea } from "@talqo/ui/components/textarea"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/bot/$botId")({
	component: BotConfigPage,
})

function BotConfigPage() {
	const { t } = useTranslation()
	const { botId } = Route.useParams()
	const { data: bot, isLoading } = useWidget(botId)
	const updateWidget = useUpdateWidget()

	const [name, setName] = useState("")
	const [systemPrompt, setSystemPrompt] = useState("")
	const [blacklist, setBlacklist] = useState("")
	const [active, setActive] = useState(false)
	const [savedAt, setSavedAt] = useState<number | null>(null)

	// Populate the form once the bot loads (or reloads after an external edit).
	useEffect(() => {
		if (bot) {
			setName(bot.name)
			setSystemPrompt(bot.systemPrompt)
			setBlacklist(bot.wordBlacklist.join(", "))
			setActive(bot.status === "active")
		}
	}, [bot])

	function handleSave(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		updateWidget(botId, {
			name: name.trim(),
			systemPrompt: systemPrompt.trim(),
			wordBlacklist: parseBlacklist(blacklist),
			status: active ? "active" : "paused",
		})
		setSavedAt(Date.now())
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<Button render={<Link to="/dashboard/bots" />} nativeButton={false} variant="ghost" className="-ml-2">
				<ArrowLeft className="size-4" />
				{t("botConfig.backToBots")}
			</Button>

			{isLoading ? (
				<p className="text-muted-foreground">{t("botConfig.loading")}</p>
			) : !bot ? (
				<p className="text-muted-foreground">{t("botConfig.notFound")}</p>
			) : (
				<>
					<PageHeader title={t("botConfig.heading", { name: bot.name })} description={t("botConfig.subheading")} />
					<Card>
						<CardHeader>
							<CardTitle>{t("botConfig.cardTitle")}</CardTitle>
							<CardDescription>{t("botConfig.cardDescription")}</CardDescription>
						</CardHeader>
						<CardContent>
							<form onSubmit={handleSave} className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="config-name">{t("botFields.name")}</Label>
									<Input
										id="config-name"
										value={name}
										onChange={(event) => setName(event.target.value)}
										placeholder={t("botFields.namePlaceholder")}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="config-system-prompt">{t("botFields.systemPrompt")}</Label>
									<Textarea
										id="config-system-prompt"
										value={systemPrompt}
										onChange={(event) => setSystemPrompt(event.target.value)}
										placeholder={t("botFields.systemPromptPlaceholder")}
										rows={5}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="config-blacklist">{t("botFields.wordBlacklist")}</Label>
									<Input
										id="config-blacklist"
										value={blacklist}
										onChange={(event) => setBlacklist(event.target.value)}
										placeholder={t("botFields.blacklistPlaceholder")}
									/>
									<p className="text-muted-foreground text-xs">{t("botFields.blacklistHelp")}</p>
									{bot.wordBlacklist.length > 0 && (
										<div className="flex flex-wrap gap-1 pt-1">
											{bot.wordBlacklist.map((word) => (
												<Badge key={word} variant="outline">
													{word}
												</Badge>
											))}
										</div>
									)}
								</div>
								<div className="flex items-center gap-2">
									<Switch id="config-status" checked={active} onCheckedChange={setActive} />
									<Label htmlFor="config-status">
										{t(active ? "botFields.statusActive" : "botFields.statusPaused")}
									</Label>
								</div>
								<div className="flex items-center gap-3 pt-2">
									<Button type="submit">{t("botConfig.save")}</Button>
									{savedAt && <span className="text-muted-foreground text-sm">{t("botConfig.saved")}</span>}
								</div>
							</form>
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}
