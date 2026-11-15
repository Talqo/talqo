import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetEmbed } from "@/api/generated/embed/embed.ts"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { ProblemAlert } from "@/components/problem-alert"
import { embedNotFound } from "@/features/embeds/load-failure"
import { requirePermission } from "@/features/permissions/require-permission"
import { retryUnlessClientError } from "@/lib/query-retry"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { DangerZone, DangerZoneRow } from "@talqo/ui/components/danger-zone"
import { Input } from "@talqo/ui/components/input"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

import { DeleteEmbedDialog } from "./-delete-embed-dialog"
import { type ColorSchemeTab, EmbedAppearanceSection } from "./-embed-appearance-section"
import { EmbedCodeCard } from "./-embed-code-card"
import { RotateEmbedTokenDialog } from "./-rotate-embed-token-dialog"

function isColorSchemeTab(value: unknown): value is ColorSchemeTab {
	return value === "light" || value === "dark"
}

export const Route = createFileRoute("/dashboard/embeds/$embedId")({
	validateSearch: (search: Record<string, unknown>) => ({
		colorTab: isColorSchemeTab(search.colorTab) ? search.colorTab : undefined,
	}),
	beforeLoad: requirePermission("agents:read"),
	component: EmbedDetailPage,
})

function EmbedDetailPage() {
	const { t } = useTranslation()
	const { embedId } = Route.useParams()
	const { colorTab = "light" } = Route.useSearch()
	const navigate = Route.useNavigate()
	const {
		data: embedResponse,
		isLoading,
		isError,
		error,
		refetch,
	} = useGetEmbed(embedId, {
		query: { retry: retryUnlessClientError },
	})
	const embed = embedResponse?.data.embed
	const agentsQuery = useListAgents({ query: { retry: retryUnlessClientError } })
	const permissions = agentsQuery.data?.data.agents.find((agent) => agent.id === embed?.agentId)?.permissions
	const canManage = permissions?.includes("agents:manage") ?? false

	function changeColorTab(value: string) {
		if (!isColorSchemeTab(value)) return
		void navigate({
			search: (prev) => ({ ...prev, colorTab: value }),
			replace: true,
			resetScroll: false,
		})
	}

	const backToAgents = (
		<Button render={<Link to="/dashboard/agents" />} nativeButton={false} variant="ghost" className="-ml-2">
			<ArrowLeft className="size-4" />
			{t("agentConfig.backToAgents")}
		</Button>
	)

	if (isLoading || agentsQuery.isPending) {
		return (
			<>
				<output className="sr-only">{t("embedSetup.loading")}</output>
				<PageSkeleton />
			</>
		)
	}
	if (isError || !embed) {
		return (
			<div className="space-y-6">
				{backToAgents}
				{embedNotFound(error) ? (
					<p className="text-muted-foreground">{t("embedSetup.notFound")}</p>
				) : (
					<ProblemAlert error={error} fallback={t("embedSetup.detailLoadError")} onRetry={() => void refetch()} />
				)}
			</div>
		)
	}
	if (agentsQuery.isError) {
		return (
			<div className="space-y-6">
				{backToAgents}
				<ProblemAlert error={agentsQuery.error} onRetry={() => void agentsQuery.refetch()} />
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<Button
				render={<Link to="/dashboard/agent/$agentId" params={{ agentId: embed.agentId }} search={{ tab: "embeds" }} />}
				nativeButton={false}
				variant="ghost"
				className="-ml-2"
			>
				<ArrowLeft className="size-4" />
				{t("embedSetup.backToAgent")}
			</Button>

			<PageHeader title={embed.name} description={t("embedSetup.detailSubheading")} />

			<EmbedCodeCard embedToken={embed.embedToken} isDisabled={embed.isDisabled} />

			<EmbedAppearanceSection
				embed={embed}
				embedId={embedId}
				canManage={canManage}
				colorTab={colorTab}
				onColorTabChange={changeColorTab}
			/>

			{canManage && (
				<>
					<Card>
						<CardHeader>
							<CardTitle>{t("embedSetup.embedToken")}</CardTitle>
							<CardDescription>{t("embedSetup.embedTokenDescription")}</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-3">
								<Input
									id="embed-token"
									value={embed.embedToken}
									readOnly
									font="mono"
									aria-label={t("embedSetup.embedToken")}
								/>
								<div className="flex justify-end">
									<RotateEmbedTokenDialog embedId={embedId} />
								</div>
							</div>
						</CardContent>
					</Card>
					<DangerZone title={t("embedSetup.dangerZone")}>
						<DangerZoneRow
							title={t("embedSetup.deleteEmbed")}
							description={t("embedSetup.dangerDescription")}
							action={<DeleteEmbedDialog embed={embed} />}
						/>
					</DangerZone>
				</>
			)}
		</div>
	)
}
