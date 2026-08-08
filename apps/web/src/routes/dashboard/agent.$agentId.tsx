import { PageHeader } from "@/components/page-header"
import { useAgent, useUpdateAgent } from "@/features/agents/agents-query"
import { parseBlacklist } from "@/features/agents/blacklist"
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

export const Route = createFileRoute("/dashboard/agent/$agentId")({
	component: AgentConfigPage,
})

function AgentConfigPage() {
	const { t } = useTranslation()
	const { agentId } = Route.useParams()
	const { data: agent, isLoading } = useAgent(agentId)
	const updateAgent = useUpdateAgent()

	const [name, setName] = useState("")
	const [systemPrompt, setSystemPrompt] = useState("")
	const [blacklist, setBlacklist] = useState("")
	const [active, setActive] = useState(false)
	const [saved, setSaved] = useState(false)

	useEffect(() => {
		if (agent) {
			setName(agent.name)
			setSystemPrompt(agent.systemPrompt)
			setBlacklist(agent.wordBlacklist.join(", "))
			setActive(agent.status === "active")
		}
	}, [agent])

	function handleSave(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		updateAgent(agentId, {
			name: name.trim(),
			systemPrompt: systemPrompt.trim(),
			wordBlacklist: parseBlacklist(blacklist),
			status: active ? "active" : "paused",
		})
		setSaved(true)
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<Button render={<Link to="/dashboard/agents" />} nativeButton={false} variant="ghost" className="-ml-2">
				<ArrowLeft className="size-4" />
				{t("agentConfig.backToAgents")}
			</Button>

			{isLoading ? (
				<p className="text-muted-foreground">{t("agentConfig.loading")}</p>
			) : !agent ? (
				<p className="text-muted-foreground">{t("agentConfig.notFound")}</p>
			) : (
				<>
					<PageHeader
						title={t("agentConfig.heading", { name: agent.name })}
						description={t("agentConfig.subheading")}
					/>
					<Card>
						<CardHeader>
							<CardTitle>{t("agentConfig.cardTitle")}</CardTitle>
							<CardDescription>{t("agentConfig.cardDescription")}</CardDescription>
						</CardHeader>
						<CardContent>
							<form onSubmit={handleSave} className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="config-name">{t("agentFields.name")}</Label>
									<Input
										id="config-name"
										value={name}
										onChange={(event) => setName(event.target.value)}
										placeholder={t("agentFields.namePlaceholder")}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="config-system-prompt">{t("agentFields.systemPrompt")}</Label>
									<Textarea
										id="config-system-prompt"
										value={systemPrompt}
										onChange={(event) => setSystemPrompt(event.target.value)}
										placeholder={t("agentFields.systemPromptPlaceholder")}
										rows={5}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="config-blacklist">{t("agentFields.wordBlacklist")}</Label>
									<Input
										id="config-blacklist"
										value={blacklist}
										onChange={(event) => setBlacklist(event.target.value)}
										placeholder={t("agentFields.blacklistPlaceholder")}
									/>
									<p className="text-muted-foreground text-xs">{t("agentFields.blacklistHelp")}</p>
									{agent.wordBlacklist.length > 0 && (
										<div className="flex flex-wrap gap-1 pt-1">
											{agent.wordBlacklist.map((word) => (
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
										{t(active ? "agentFields.statusActive" : "agentFields.statusPaused")}
									</Label>
								</div>
								<div className="flex items-center gap-3 pt-2">
									<Button type="submit">{t("agentConfig.save")}</Button>
									{saved && <span className="text-muted-foreground text-sm">{t("agentConfig.saved")}</span>}
								</div>
							</form>
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}
