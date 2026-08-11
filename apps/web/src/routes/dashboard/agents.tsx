import { PageHeader } from "@/components/page-header"
import { agentFormSchema, type AgentFormValues } from "@/features/agents/agent-schema"
import { useAgents, useCreateAgent, useUpdateAgent, type Agent } from "@/features/agents/agents-query"
import { parseBlacklist } from "@/features/agents/blacklist"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@talqo/ui/components/card"
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
import { useState } from "react"
import { useForm } from "react-hook-form"
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

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<AgentFormValues>({
		resolver: zodResolver(agentFormSchema),
		defaultValues: { name: "", systemPrompt: "", wordBlacklist: "", active: true },
	})

	function onValid(values: AgentFormValues) {
		createAgent({
			name: values.name.trim(),
			systemPrompt: values.systemPrompt.trim(),
			status: "active",
			wordBlacklist: parseBlacklist(values.wordBlacklist),
		})
		reset({ name: "", systemPrompt: "", wordBlacklist: "", active: true })
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
							<form onSubmit={handleSubmit(onValid)} className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="agent-name">{t("agentFields.name")}</Label>
									<Input
										id="agent-name"
										placeholder={t("agentFields.namePlaceholder")}
										aria-invalid={errors.name ? true : undefined}
										{...register("name")}
									/>
									{errors.name && <p className="text-destructive text-xs">{t("agentFields.nameRequired")}</p>}
								</div>
								<div className="space-y-2">
									<Label htmlFor="agent-system-prompt">{t("agentFields.systemPrompt")}</Label>
									<Textarea
										id="agent-system-prompt"
										placeholder={t("agentFields.systemPromptPlaceholder")}
										rows={4}
										aria-invalid={errors.systemPrompt ? true : undefined}
										{...register("systemPrompt")}
									/>
									{errors.systemPrompt && (
										<p className="text-destructive text-xs">{t("agentFields.systemPromptRequired")}</p>
									)}
								</div>
								<div className="space-y-2">
									<Label htmlFor="agent-word-blacklist">{t("agentFields.wordBlacklist")}</Label>
									<Input
										id="agent-word-blacklist"
										placeholder={t("agentFields.blacklistPlaceholder")}
										{...register("wordBlacklist")}
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
								<CardTitle>{agent.name}</CardTitle>
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
