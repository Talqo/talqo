import { type CreateAgentMutationError, useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { buildNameCandidates, useCreateAgent } from "@/features/agents/create-agent-mutation"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { FileText, MessageSquare, Plus, Wrench } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/agents")({
	component: AgentsPage,
})

// "—", never 0: zero would claim "no usage" while those modules don't exist yet.
// TODO(usage-api): per-agent conversation totals once GET /api/agents/:id/usage-summary lands.
// TODO(knowledge-api): file count once GET /api/agents/:id/files lands.
// TODO(mcp-api): MCP server count once GET /api/agents/:id/mcp-servers lands.
const PLACEHOLDER_VALUE = "—"

function AgentCardMetric({ icon: Icon, label }: { icon: typeof MessageSquare; label: string }) {
	return (
		<span className="text-muted-foreground flex items-center gap-1 text-xs" title={label}>
			<Icon className="size-3.5" aria-hidden />
			{label}: {PLACEHOLDER_VALUE}
		</span>
	)
}

const FORBIDDEN_STATUS = 403

function AgentsPage() {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const navigate = useNavigate()
	const permissionsQuery = useGetMyPermissions()
	const permissions = permissionsQuery.data?.data.permissions
	const { data, error, isLoading, refetch, isFetching } = useListAgents()
	const agents = data?.data.agents
	const createAgent = useCreateAgent()
	const [createError, setCreateError] = useState<string | null>(null)

	const canRead = permissions?.includes("agents:read") ?? false
	const canManage = permissions?.includes("agents:manage") ?? false

	async function handleCreate() {
		setCreateError(null)
		try {
			const agent = await createAgent.mutateAsync({
				systemPrompt: t("agents.defaultSystemPrompt"),
				wordBlacklist: [],
				candidates: buildNameCandidates(t("agents.defaultName")),
			})
			await navigate({ to: "/dashboard/agent/$agentId", params: { agentId: agent.id } })
		} catch (caught) {
			setCreateError(
				(caught as CreateAgentMutationError).status === FORBIDDEN_STATUS
					? t("agents.manageForbidden")
					: t("agents.createFailed"),
			)
		}
	}

	if (permissionsQuery.isLoading) {
		return (
			<div className="mx-auto max-w-5xl">
				<p className="text-muted-foreground">{t("agents.loading")}</p>
			</div>
		)
	}

	if (!canRead) {
		return (
			<div className="mx-auto max-w-5xl space-y-6">
				<PageHeader title={t("agents.heading")} description={t("agents.subheading")} />
				<AccessDenied />
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<PageHeader
				title={t("agents.heading")}
				description={t("agents.subheading")}
				actions={
					canManage ? (
						<Button onClick={handleCreate} disabled={createAgent.isPending}>
							<Plus className="size-4" />
							{createAgent.isPending ? t("agents.creating") : t("agents.create")}
						</Button>
					) : undefined
				}
			/>

			{createError && (
				<p role="alert" className="text-destructive text-sm">
					{createError}
				</p>
			)}

			{isLoading ? (
				<p className="text-muted-foreground">{t("agents.loading")}</p>
			) : error ? (
				<div className="space-y-2">
					<p role="alert" className="text-destructive text-sm">
						{t("agents.loadFailed")}
					</p>
					<Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
						{t("agents.retry")}
					</Button>
				</div>
			) : !agents?.length ? (
				<p className="text-muted-foreground">{t("agents.empty")}</p>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{agents.map((agent) => (
						<Link key={agent.id} to="/dashboard/agent/$agentId" params={{ agentId: agent.id }} className="group">
							<Card className="group-hover:border-primary/40 h-full transition-colors">
								<CardHeader>
									<CardTitle>{agent.name}</CardTitle>
									<p className="text-muted-foreground text-xs">
										{t("agents.updated", {
											date: new Date(agent.updatedAt).toLocaleDateString(language, {
												year: "numeric",
												month: "short",
												day: "numeric",
											}),
										})}
									</p>
								</CardHeader>
								<CardContent>
									<div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3">
										<AgentCardMetric icon={MessageSquare} label={t("agents.metricConversations")} />
										<AgentCardMetric icon={FileText} label={t("agents.metricFiles")} />
										<AgentCardMetric icon={Wrench} label={t("agents.metricMcpTools")} />
									</div>
								</CardContent>
							</Card>
						</Link>
					))}
				</div>
			)}
		</div>
	)
}
