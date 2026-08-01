import { PageHeader } from "@/components/page-header"
import { useAgents, useCreateAgent, useUpdateAgent, type Agent } from "@/features/agents/agents-query"
import { parseBlacklist } from "@/features/agents/blacklist"
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

export const Route = createFileRoute("/dashboard/agents")({
	component: AgentsPage,
})

function AgentsPage() {
	const { t } = useTranslation()
	const { data: agents, isLoading } = useAgents()
	const [dialogOpen, setDialogOpen] = useState(false)
	const createAgent = useCreateAgent()
	const updateAgent = useUpdateAgent()

	function toggleStatus(agent: Agent) {
		updateAgent(agent.id, {
			status: agent.status === "active" ? "paused" : "active",
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
		createAgent({
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
				title={t("agents.heading")}
				description={t("agents.subheading")}
				actions={
					<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
						<DialogTrigger render={<Button />}>
							<Plus className="size-4" />
							{t("agents.create")}
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>{t("agents.create")}</DialogTitle>
								<DialogDescription>{t("agents.createDescription")}</DialogDescription>
							</DialogHeader>
							<form onSubmit={handleCreate} className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="agent-name">{t("agentFields.name")}</Label>
									<Input id="agent-name" name="name" placeholder={t("agentFields.namePlaceholder")} required />
								</div>
								<div className="space-y-2">
									<Label htmlFor="agent-system-prompt">{t("agentFields.systemPrompt")}</Label>
									<Textarea
										id="agent-system-prompt"
										name="systemPrompt"
										placeholder={t("agentFields.systemPromptPlaceholder")}
										rows={4}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="agent-word-blacklist">{t("agentFields.wordBlacklist")}</Label>
									<Input
										id="agent-word-blacklist"
										name="wordBlacklist"
										placeholder={t("agentFields.blacklistPlaceholder")}
									/>
									<p className="text-muted-foreground text-xs">{t("agentFields.blacklistHelp")}</p>
								</div>
								<DialogFooter>
									<Button type="submit">{t("agents.create")}</Button>
								</DialogFooter>
							</form>
						</DialogContent>
					</Dialog>
				}
			/>

			{isLoading ? (
				<p className="text-muted-foreground">{t("agents.loading")}</p>
			) : !agents?.length ? (
				<p className="text-muted-foreground">{t("agents.empty")}</p>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{agents.map((agent) => (
						<Card key={agent.id}>
							<CardHeader>
								<div className="flex items-center justify-between gap-2">
									<CardTitle>{agent.name}</CardTitle>
									<Badge variant={agent.status === "active" ? "default" : "secondary"}>
										{t(agent.status === "active" ? "agentFields.statusActive" : "agentFields.statusPaused")}
									</Badge>
								</div>
								<CardDescription className="line-clamp-2">{agent.systemPrompt}</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="flex items-center justify-between gap-2">
									<div className="flex items-center gap-2">
										<Switch
											id={`status-${agent.id}`}
											checked={agent.status === "active"}
											onCheckedChange={() => toggleStatus(agent)}
										/>
										<Label htmlFor={`status-${agent.id}`}>
											{t(agent.status === "active" ? "agentFields.statusActive" : "agentFields.statusPaused")}
										</Label>
									</div>
									<Button
										render={<Link to="/dashboard/agent/$agentId" params={{ agentId: agent.id }} />}
										nativeButton={false}
										variant="outline"
										size="sm"
									>
										<Settings2 className="size-4" />
										{t("agents.configure")}
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
