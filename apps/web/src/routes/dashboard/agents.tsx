import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { ProblemAlert } from "@/components/problem-alert"
import { AgentCardSummary } from "@/features/agents/agent-card-summary"
import { useCreateAgentFlow } from "@/features/agents/use-create-agent-flow"
import { ProviderNoticeBanner } from "@/features/ai-configuration/provider-notice-banner"
import { requirePermission } from "@/features/permissions/require-permission"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader } from "@talqo/ui/components/card"
import { CardLink } from "@talqo/ui/components/card-link"
import { CardName } from "@talqo/ui/components/card-name"
import { EmptyState } from "@talqo/ui/components/empty-state"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Bot, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/agents")({
	beforeLoad: requirePermission("agents:read"),
	component: AgentsPage,
})

function AgentsSkeleton({ label }: { label: string }) {
	return (
		<div className="grid gap-4 md:grid-cols-2">
			<output className="sr-only">{label}</output>
			{Array.from({ length: 4 }, (_, index) => (
				<Card key={index}>
					<CardHeader>
						<Skeleton className="h-5 w-40 max-w-full" />
						<Skeleton className="h-3 w-32" />
					</CardHeader>
					<CardContent>
						<div className="flex flex-wrap gap-4">
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
	const { data, error, isLoading, refetch } = useListAgents()
	const agents = data?.data.agents.filter((agent) => agent.permissions.includes("agents:read"))
	const canManage = useGetMyPermissions().data?.data.permissions.includes("admin") ?? false
	const { create, pending, failure } = useCreateAgentFlow({
		names: agents?.map((agent) => agent.name) ?? [],
		refreshNames: refetch,
		onCreated: async (agentId) => {
			await refetch()
			await navigate({ to: "/dashboard/agent/$agentId", params: { agentId }, search: { tab: undefined } })
		},
	})

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("agents.heading")}
				description={t("agents.subheading")}
				actions={
					canManage ? (
						<Button onClick={() => void create()} disabled={pending}>
							<Plus className="size-4" />
							{pending ? t("agents.creating") : t("agents.create")}
						</Button>
					) : undefined
				}
			/>

			<ProblemAlert message={failure?.message} onRetry={failure?.retryable ? () => void create() : undefined} />

			<ProviderNoticeBanner />

			{isLoading ? (
				<AgentsSkeleton label={t("agents.loading")} />
			) : error ? (
				<ProblemAlert error={error} fallback={t("agents.loadFailed")} onRetry={() => void refetch()} />
			) : !agents?.length ? (
				<EmptyState
					icon={Bot}
					title={t("agents.emptyTitle")}
					description={canManage ? t("agents.emptyDescriptionManager") : t("agents.emptyDescriptionReader")}
					actions={
						canManage ? (
							<Button onClick={() => void create()} disabled={pending}>
								<Plus className="size-4" />
								{pending ? t("agents.creating") : t("agents.create")}
							</Button>
						) : undefined
					}
				/>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{agents.map((agent) => (
						<Card key={agent.id} variant="interactive" className="relative h-full">
							<CardHeader>
								<CardName>{agent.name}</CardName>
								<CardDescription>
									{t("agents.updated", {
										date: new Date(agent.updatedAt).toLocaleDateString(language, {
											year: "numeric",
											month: "short",
											day: "numeric",
										}),
									})}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<AgentCardSummary agentId={agent.id} />
							</CardContent>
							<CardLink
								render={
									<Link to="/dashboard/agent/$agentId" params={{ agentId: agent.id }} search={{ tab: undefined }} />
								}
								aria-label={agent.name}
							/>
						</Card>
					))}
				</div>
			)}
		</div>
	)
}
