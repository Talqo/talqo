import type { AgentWebsite } from "@/api/generated/models/agentWebsite.zod"

import {
	getListAgentWebsitesQueryKey,
	getListAgentWebsitesQueryOptions,
	useAddAgentWebsite,
	useDeleteAgentWebsite,
	useListAgentWebsites,
	useRefreshAgentWebsite,
} from "@/api/generated/agent/agent.ts"
import { ProblemAlert } from "@/components/problem-alert"
import { hasActiveIngestion, INGESTION_REFRESH_MS, IngestionStatusLine } from "@/features/context/ingestion-status"
import { formatDateTime } from "@/lib/format-date"
import { getProblemMessage } from "@/lib/problem-message"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
import { EmptyState } from "@talqo/ui/components/empty-state"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { useQueryClient } from "@tanstack/react-query"
import { Globe, LoaderCircleIcon, RotateCcw, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

const statusMessages = {
	pending: "agentWebsites.status.pending",
	processing: "agentWebsites.status.processing",
	ready: "agentWebsites.status.ready",
	failed: "agentWebsites.status.failed",
} as const satisfies Record<AgentWebsite["embeddingStatus"], string>

const errorMessages = {
	"conversion-failed": "agentWebsites.error.conversionFailed",
	"empty-document": "agentWebsites.error.emptyDocument",
	"provider-error": "agentWebsites.error.providerError",
	unknown: "agentWebsites.error.unknown",
	"website-blocked": "agentWebsites.error.websiteBlocked",
	"website-unreachable": "agentWebsites.error.websiteUnreachable",
	"website-too-large": "agentWebsites.error.websiteTooLarge",
} as const satisfies Record<NonNullable<AgentWebsite["embeddingError"]>, string>

function useWebsitesQuery(agentId: string) {
	const queryClient = useQueryClient()
	const query = useListAgentWebsites(agentId, {
		query: {
			...getListAgentWebsitesQueryOptions(agentId),
			refetchInterval: (current) =>
				hasActiveIngestion(current.state.data?.data.websites) ? INGESTION_REFRESH_MS : false,
		},
	})
	function invalidate() {
		return queryClient.invalidateQueries({ queryKey: getListAgentWebsitesQueryKey(agentId) })
	}
	return { query, invalidate }
}

function WebsiteStatus({ website, t }: { website: AgentWebsite; t: (key: string) => string }) {
	return (
		<IngestionStatusLine
			status={website.embeddingStatus}
			label={t(statusMessages[website.embeddingStatus])}
			errorLabel={
				website.embeddingStatus === "failed" && website.embeddingError
					? t(errorMessages[website.embeddingError])
					: undefined
			}
		/>
	)
}

function AddWebsiteForm({ agentId, canManage, invalidate }: { agentId: string; canManage: boolean; invalidate: () => Promise<unknown> }) {
	const { t } = useTranslation()
	const addWebsite = useAddAgentWebsite()
	const [url, setUrl] = useState("")
	const [error, setError] = useState<string | null>(null)
	if (!canManage) return null

	async function submit(event: React.FormEvent) {
		event.preventDefault()
		const input = url.trim()
		if (!input || addWebsite.isPending) return
		setError(null)
		try {
			await addWebsite.mutateAsync({ agentId, data: { url: input } })
			setUrl("")
			await invalidate()
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("agentWebsites.addFailed")))
		}
	}

	return (
		<form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => void submit(event)}>
			<div className="min-w-0 flex-1 space-y-2">
				<Label htmlFor="agent-website-url">{t("agentWebsites.urlLabel")}</Label>
				<Input
					id="agent-website-url"
					type="url"
					required
					value={url}
					placeholder={t("agentWebsites.urlPlaceholder")}
					disabled={addWebsite.isPending}
					onChange={(event) => setUrl(event.target.value)}
				/>
			</div>
			<Button type="submit" disabled={addWebsite.isPending || !url.trim()}>
				{addWebsite.isPending && <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />}
				{addWebsite.isPending ? t("agentWebsites.adding") : t("agentWebsites.addAction")}
			</Button>
			{error && (
				<p role="alert" className="text-destructive text-xs sm:basis-full">
					{error}
				</p>
			)}
		</form>
	)
}

function WebsiteRow(props: {
	website: AgentWebsite
	canManage: boolean
	refreshing: boolean
	onRefresh: (website: AgentWebsite) => void
	onDelete: (website: AgentWebsite) => void
}) {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const { website } = props
	const canRefresh = website.embeddingStatus === "ready" || website.embeddingStatus === "failed"
	return (
		<li className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
			<Globe className="text-muted-foreground hidden size-4 shrink-0 sm:block" />
			<div className="min-w-0 flex-1 space-y-1">
				<a href={website.url} target="_blank" rel="noreferrer" className="block truncate text-sm underline-offset-4 hover:underline" title={website.url}>
					{website.url}
				</a>
				<p className="text-muted-foreground text-xs">{formatDateTime(website.createdAt, language)}</p>
				<WebsiteStatus website={website} t={t} />
			</div>
			{props.canManage && (
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{canRefresh && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={props.refreshing}
							aria-label={t(website.embeddingStatus === "failed" ? "agentWebsites.retry" : "agentWebsites.refresh", {
								url: website.url,
							})}
							onClick={() => props.onRefresh(website)}
						>
							{props.refreshing ? <LoaderCircleIcon aria-hidden className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
							{website.embeddingStatus === "failed" ? t("agentWebsites.retryAction") : t("agentWebsites.refreshAction")}
						</Button>
					)}
					<Button
						type="button"
						variant="destructive"
						size="icon"
						aria-label={t("agentWebsites.delete", { url: website.url })}
						onClick={() => props.onDelete(website)}
					>
						<Trash2 className="size-4" />
					</Button>
				</div>
			)}
		</li>
	)
}

function WebsitesContent(props: {
	websites: AgentWebsite[]
	canManage: boolean
	isLoading: boolean
	isError: boolean
	error: unknown
	refetch: () => Promise<unknown>
	refreshingId: string | null
	onRefresh: (website: AgentWebsite) => void
	onDelete: (website: AgentWebsite) => void
}) {
	const { t } = useTranslation()
	if (props.isLoading) {
		return (
			<div className="space-y-2" aria-busy="true">
				<output className="sr-only">{t("agentWebsites.loading")}</output>
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
			</div>
		)
	}
	if (props.isError) return <ProblemAlert error={props.error} onRetry={() => void props.refetch()} />
	if (!props.websites.length) {
		if (props.canManage) return null
		return <EmptyState icon={Globe} title={t("agentWebsites.emptyTitle")} description={t("agentWebsites.emptyDescriptionReader")} />
	}
	return (
		<ul className="divide-border divide-y rounded-md border">
			{props.websites.map((website) => (
				<WebsiteRow
					key={website.id}
					website={website}
					canManage={props.canManage}
					refreshing={props.refreshingId === website.id}
					onRefresh={props.onRefresh}
					onDelete={props.onDelete}
				/>
			))}
		</ul>
	)
}

export function AgentWebsitesCard({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const { query, invalidate } = useWebsitesQuery(agentId)
	const refreshWebsite = useRefreshAgentWebsite()
	const deleteWebsite = useDeleteAgentWebsite()
	const [refreshingId, setRefreshingId] = useState<string | null>(null)
	const [operationError, setOperationError] = useState<string | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<AgentWebsite | null>(null)
	const [deleteError, setDeleteError] = useState<string | null>(null)
	const websites = query.data?.data.websites ?? []

	async function refresh(website: AgentWebsite) {
		setOperationError(null)
		setRefreshingId(website.id)
		try {
			await refreshWebsite.mutateAsync({ agentId, websiteId: website.id })
			await invalidate()
		} catch (caught) {
			setOperationError(getProblemMessage(caught, t, t("agentWebsites.refreshFailed")))
		} finally {
			setRefreshingId(null)
		}
	}

	async function confirmDelete() {
		if (!deleteTarget) return
		setDeleteError(null)
		try {
			await deleteWebsite.mutateAsync({ agentId, websiteId: deleteTarget.id })
			await invalidate()
			setDeleteTarget(null)
		} catch (caught) {
			setDeleteError(getProblemMessage(caught, t, t("agentWebsites.deleteFailed")))
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("agentWebsites.cardTitle")}</CardTitle>
				{query.data && <CardDescription>{t("agentWebsites.cardDescription", { maxPages: query.data.data.maxPages })}</CardDescription>}
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					<AddWebsiteForm agentId={agentId} canManage={canManage} invalidate={invalidate} />
					{operationError && (
						<p role="alert" className="text-destructive text-xs">
							{operationError}
						</p>
					)}
					<WebsitesContent
						websites={websites}
						canManage={canManage}
						isLoading={query.isLoading}
						isError={query.isError}
						error={query.error}
						refetch={query.refetch}
						refreshingId={refreshingId}
						onRefresh={(website) => void refresh(website)}
						onDelete={(website) => {
							setDeleteError(null)
							setDeleteTarget(website)
						}}
					/>
				</div>
			</CardContent>
			<ConfirmDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => {
					if (!open && !deleteWebsite.isPending) {
						setDeleteTarget(null)
						setDeleteError(null)
					}
				}}
				title={t("agentWebsites.deleteTitle")}
				description={t("agentWebsites.deletePrompt")}
				cancelLabel={t("common.cancel")}
				confirmLabel={t("agentWebsites.deleteConfirm")}
				pendingLabel={t("agentWebsites.deleting")}
				pending={deleteWebsite.isPending}
				error={deleteError ?? undefined}
				onConfirm={() => void confirmDelete()}
			>
				<p className="break-all text-sm font-medium">{deleteTarget?.url}</p>
			</ConfirmDialog>
		</Card>
	)
}
