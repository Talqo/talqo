import { PageHeader } from "@/components/page-header"
import { parseBlacklist } from "@/features/widgets/blacklist"
import { useCreateWidget, useUpdateWidget, useWidgets, type Widget } from "@/features/widgets/widgets-query"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@talqo/ui/components/dialog"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Switch } from "@talqo/ui/components/switch"
import { Textarea } from "@talqo/ui/components/textarea"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Plus, Settings2 } from "lucide-react"
import { type FormEvent, useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/bots")({
	component: BotsPage,
})

function BotsPage() {
	const { t } = useTranslation()
	const { data: bots, isLoading } = useWidgets()
	const [dialogOpen, setDialogOpen] = useState(false)
	const createWidget = useCreateWidget()
	const updateWidget = useUpdateWidget()

	function toggleStatus(bot: Widget) {
		updateWidget(bot.id, {
			status: bot.status === "active" ? "paused" : "active",
		})
	}

	function handleCreate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		const name = String(form.get("name") ?? "").trim()
		const systemPrompt = String(form.get("systemPrompt") ?? "").trim()
		if (!name || !systemPrompt) {
			return
		}
		createWidget({
			name,
			systemPrompt,
			status: "active",
			wordBlacklist: parseBlacklist(String(form.get("wordBlacklist") ?? "")),
		})
		setDialogOpen(false)
	}

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<PageHeader
				title={t("bots.heading")}
				description={t("bots.subheading")}
				actions={
					<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
						<DialogTrigger render={<Button />}>
							<Plus className="size-4" />
							{t("bots.create")}
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>{t("bots.create")}</DialogTitle>
								<DialogDescription>{t("bots.createDescription")}</DialogDescription>
							</DialogHeader>
							<form onSubmit={handleCreate} className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="bot-name">{t("botFields.name")}</Label>
									<Input id="bot-name" name="name" placeholder={t("botFields.namePlaceholder")} required />
								</div>
								<div className="space-y-2">
									<Label htmlFor="bot-system-prompt">{t("botFields.systemPrompt")}</Label>
									<Textarea
										id="bot-system-prompt"
										name="systemPrompt"
										placeholder={t("botFields.systemPromptPlaceholder")}
										rows={4}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="bot-word-blacklist">{t("botFields.wordBlacklist")}</Label>
									<Input
										id="bot-word-blacklist"
										name="wordBlacklist"
										placeholder={t("botFields.blacklistPlaceholder")}
									/>
									<p className="text-muted-foreground text-xs">{t("botFields.blacklistHelp")}</p>
								</div>
								<DialogFooter>
									<Button type="submit">{t("bots.create")}</Button>
								</DialogFooter>
							</form>
						</DialogContent>
					</Dialog>
				}
			/>

			{isLoading ? (
				<p className="text-muted-foreground">{t("bots.loading")}</p>
			) : !bots?.length ? (
				<p className="text-muted-foreground">{t("bots.empty")}</p>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{bots.map((bot) => (
						<Card key={bot.id}>
							<CardHeader>
								<div className="flex items-center justify-between gap-2">
									<CardTitle>{bot.name}</CardTitle>
									<Badge variant={bot.status === "active" ? "default" : "secondary"}>
										{t(bot.status === "active" ? "botFields.statusActive" : "botFields.statusPaused")}
									</Badge>
								</div>
								<CardDescription className="line-clamp-2">{bot.systemPrompt}</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="flex items-center justify-between gap-2">
									<div className="flex items-center gap-2">
										<Switch
											id={`status-${bot.id}`}
											checked={bot.status === "active"}
											onCheckedChange={() => toggleStatus(bot)}
										/>
										<Label htmlFor={`status-${bot.id}`}>
											{t(bot.status === "active" ? "botFields.statusActive" : "botFields.statusPaused")}
										</Label>
									</div>
									<Button
										render={<Link to="/dashboard/bot/$botId" params={{ botId: bot.id }} />}
										nativeButton={false}
										variant="outline"
										size="sm"
									>
										<Settings2 className="size-4" />
										{t("bots.configure")}
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	)
}
