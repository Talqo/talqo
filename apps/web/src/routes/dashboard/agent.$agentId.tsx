import { PageHeader } from "@/components/page-header"
import { useUpdateAgent } from "@/features/agents/agent-mutation"
import { agentFormSchema, type AgentFormValues } from "@/features/agents/agent-schema"
import { useAgent } from "@/features/agents/agents-query"
import { parseBlacklist } from "@/features/agents/blacklist"
import { zodResolver } from "@hookform/resolvers/zod"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Switch } from "@talqo/ui/components/switch"
import { Textarea } from "@talqo/ui/components/textarea"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/agent/$agentId")({
	component: AgentConfigPage,
})

function AgentConfigPage() {
	const { t } = useTranslation()
	const { agentId } = Route.useParams()
	const { data: agent, isLoading, isError } = useAgent(agentId)
	const updateAgent = useUpdateAgent()

	const {
		register,
		handleSubmit,
		reset,
		control,
		watch,
		formState: { errors },
	} = useForm<AgentFormValues>({
		resolver: zodResolver(agentFormSchema),
		defaultValues: { name: "", systemPrompt: "", wordBlacklist: "", active: false },
	})

	const active = watch("active")

	useEffect(() => {
		if (agent) {
			reset({
				name: agent.name,
				systemPrompt: agent.systemPrompt,
				wordBlacklist: agent.wordBlacklist.join(", "),
				active: agent.status === "active",
			})
		}
	}, [agent, reset])

	function onValid(values: AgentFormValues) {
		updateAgent.mutate({
			id: agentId,
			name: values.name.trim(),
			systemPrompt: values.systemPrompt.trim(),
			wordBlacklist: parseBlacklist(values.wordBlacklist),
			status: values.active ? "active" : "paused",
		})
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<Button render={<Link to="/dashboard/agents" />} nativeButton={false} variant="ghost" className="-ml-2">
				<ArrowLeft className="size-4" />
				{t("agentConfig.backToAgents")}
			</Button>

			{isLoading ? (
				<p className="text-muted-foreground">{t("agentConfig.loading")}</p>
			) : isError || !agent ? (
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
							<form onSubmit={handleSubmit(onValid)} className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="config-name">{t("agentFields.name")}</Label>
									<Input
										id="config-name"
										placeholder={t("agentFields.namePlaceholder")}
										aria-invalid={errors.name ? true : undefined}
										{...register("name")}
									/>
									{errors.name && <p className="text-destructive text-xs">{t("agentFields.nameRequired")}</p>}
								</div>
								<div className="space-y-2">
									<Label htmlFor="config-system-prompt">{t("agentFields.systemPrompt")}</Label>
									<Textarea
										id="config-system-prompt"
										placeholder={t("agentFields.systemPromptPlaceholder")}
										rows={5}
										aria-invalid={errors.systemPrompt ? true : undefined}
										{...register("systemPrompt")}
									/>
									{errors.systemPrompt && (
										<p className="text-destructive text-xs">{t("agentFields.systemPromptRequired")}</p>
									)}
								</div>
								<div className="space-y-2">
									<Label htmlFor="config-blacklist">{t("agentFields.wordBlacklist")}</Label>
									<Input
										id="config-blacklist"
										placeholder={t("agentFields.blacklistPlaceholder")}
										{...register("wordBlacklist")}
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
									<Controller
										control={control}
										name="active"
										render={({ field }) => (
											<Switch id="config-status" checked={field.value} onCheckedChange={field.onChange} />
										)}
									/>
									<Label htmlFor="config-status">
										{t(active ? "agentFields.statusActive" : "agentFields.statusPaused")}
									</Label>
								</div>
								{updateAgent.isError && (
									<p role="alert" className="text-destructive text-sm">
										{t("agentConfig.saveError")}
									</p>
								)}
								<div className="flex items-center gap-3 pt-2">
									<Button type="submit" disabled={updateAgent.isPending}>
										{updateAgent.isPending ? t("agentConfig.saving") : t("agentConfig.save")}
									</Button>
									{updateAgent.isSuccess && !updateAgent.isPending && (
										<span className="text-muted-foreground text-sm">{t("agentConfig.saved")}</span>
									)}
								</div>
							</form>
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}
