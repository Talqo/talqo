import { type CreateAgentMutationError, useCreateAgent, useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { AgentCardSummary } from "@/features/agents/agent-card-summary"
import { ProviderNoticeBanner } from "@/features/ai-configuration/provider-notice-banner"
import { requirePermission } from "@/features/permissions/require-permission"
import { nextDefaultName } from "@/lib/default-name"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/agents")({
	beforeLoad: requirePermission("agents:read"),
	component: AgentsPage,
})

const FORBIDDEN_STATUS = 403
const CONFLICT_STATUS = 409

function AgentsSkeleton({ label }: { label: string }) {
	return (
		<div className="grid gap-4 md:grid-cols-2" aria-busy="true">
			<output className="sr-only">{label}</output>
			{Array.from({ length: 4 }, (_, index) => (
				<Card key={index}>
					<CardHeader>
						<Skeleton className="h-5 w-40 max-w-full" />
						<Skeleton className="h-3 w-32" />
					</CardHeader>
					<CardContent>
						<div className="flex flex-wrap gap-4 border-t pt-3">
							<Skeleton className="h-3 w-20" />
							<Skeleton className="h-3 w-24" />
							<Skeleton className="h-3 w-24" />
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	)
}

function AgentsPage() {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const navigate = useNavigate()
	const { data, error, isLoading, refetch, isFetching } = useListAgents()
	const agents = data?.data.agents.filter((agent) => agent.permissions.includes("agents:read"))
	const createAgent = useCreateAgent()
	const [createError, setCreateError] = useState<string | null>(null)

	const canManage = useGetMyPermissions().data?.data.permissions.includes("admin") ?? false

	async function handleCreate() {
		setCreateError(null)
		try {
			const result = await createAgent.mutateAsync({
				data: {
					name: nextDefaultName(agents?.map((agent) => agent.name) ?? [], t("agents.defaultName")),
					systemPrompt: t("agents.defaultSystemPrompt"),
					wordBlacklist: [],
				},
			})
			const agent = result.data.agent
			await refetch()
			await navigate({ to: "/dashboard/agent/$agentId", params: { agentId: agent.id }, search: { tab: undefined } })
		} catch (caught) {
			const status = (caught as CreateAgentMutationError).status
			setCreateError(
				status === FORBIDDEN_STATUS
					? t("agents.manageForbidden")
					: status === CONFLICT_STATUS
						? t("agents.nameConflict")
						: t("agents.createFailed"),
			)
		}
	}

	return (
		<div className="space-y-6">
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

			<ProviderNoticeBanner />

			{createError && (
				<p role="alert" className="text-destructive text-sm">
					{createError}
				</p>
			)}

			{isLoading ? (
				<AgentsSkeleton label={t("agents.loading")} />
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
						<Link
							key={agent.id}
							to="/dashboard/agent/$agentId"
							params={{ agentId: agent.id }}
							search={{ tab: undefined }}
							className="group"
						>
							<Card variant="interactive" className="h-full">
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
									<AgentCardSummary agentId={agent.id} />
								</CardContent>
							</Card>
						</Link>
					))}
				</div>
			)}
		</div>
	)
}
