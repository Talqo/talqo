import type { Agent } from "@/api/generated/models/agent.zod"
import type { Embed } from "@/api/generated/models/embed.zod"

import {
	type DeleteAgentMutationError,
	type UpdateAgentMutationError,
	useDeleteAgent,
	useGetAgent,
	useListAgents,
	useUpdateAgent,
} from "@/api/generated/agent/agent.ts"
import {
	getListEmbedsQueryKey,
	type ListEmbedsQueryError,
	type ListEmbedsQueryResult,
	useCreateEmbed,
	useListEmbeds,
} from "@/api/generated/embed/embed.ts"
import { FloatingActionButton } from "@/components/floating-action-button"
import { PageHeader } from "@/components/page-header"
import { ProblemAlert } from "@/components/problem-alert"
import {
	AGENT_NAME_MAX_LENGTH,
	agentFormSchema,
	type AgentFormValues,
	SYSTEM_PROMPT_MAX_LENGTH,
} from "@/features/agents/agent-schema"
import { BlacklistTermsEditor } from "@/features/agents/components/blacklist-terms-editor"
import { AgentFilesCard } from "@/features/context/agent-files-card"
import { EMBED_FORM_DEFAULTS } from "@/features/embeds/embed-appearance-form"
import { McpConnectionsCard } from "@/features/mcp/mcp-connections-card"
import { clearAgentContent } from "@/features/permissions/clear-agent-content"
import { requirePermission } from "@/features/permissions/require-permission"
import { TestChatCard } from "@/features/test-chat/test-chat-card"
import { nextDefaultName } from "@/lib/default-name"
import { getProblemMessage } from "@/lib/problem-message"
import { useDirtyFormGuard } from "@/lib/use-dirty-form-guard"
import { zodResolver } from "@hookform/resolvers/zod"
import { isSupportedLanguage, supportedLanguages } from "@talqo/shared/languages"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { CardLink } from "@talqo/ui/components/card-link"
import { CardName } from "@talqo/ui/components/card-name"
import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
import { DangerZone, DangerZoneRow } from "@talqo/ui/components/danger-zone"
import { EmptyState } from "@talqo/ui/components/empty-state"
import { FormActions } from "@talqo/ui/components/form-actions"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@talqo/ui/components/tabs"
import { Textarea } from "@talqo/ui/components/textarea"
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, CodeXml, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { type FieldErrors, useForm, type UseFormRegister, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { EmbedEnabledSwitch } from "./-embed-enabled-switch"

const AGENT_TABS = ["configuration", "context", "embeds", "mcp", "test-chat"] as const
const LIGHT_PALETTE_KEYS = ["primary", "background", "surface", "text", "textOnPrimary"] as const
type AgentTab = (typeof AGENT_TABS)[number]
type EmbedsQuery = UseQueryResult<ListEmbedsQueryResult, ListEmbedsQueryError>

function isAgentTab(value: unknown): value is AgentTab {
	return (AGENT_TABS as readonly unknown[]).includes(value)
}

export const Route = createFileRoute("/dashboard/agent/$agentId")({
	validateSearch: (search: Record<string, unknown>) => ({
		tab: isAgentTab(search.tab) ? search.tab : undefined,
	}),
	beforeLoad: requirePermission("agents:read"),
	component: AgentConfigPage,
})

const CONFLICT_STATUS = 409
const FORBIDDEN_STATUS = 403
const NOT_FOUND_STATUS = 404

function AgentConfigSkeleton({ label }: { label: string }) {
	return (
		<div className="space-y-6">
			<output className="sr-only">{label}</output>
			<div className="space-y-3">
				<Skeleton className="h-8 w-48 max-w-full" />
				<Skeleton className="h-4 w-64 max-w-full" />
			</div>
			<Skeleton className="h-9 w-80 max-w-full" />
			<Card>
				<CardHeader>
					<Skeleton className="h-5 w-32" />
					<Skeleton className="h-4 w-72 max-w-full" />
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<div className="space-y-2">
							<Skeleton className="h-4 w-16" />
							<Skeleton className="h-9 w-full" />
						</div>
						<div className="space-y-2">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-32 w-full" />
						</div>
						<Skeleton className="h-9 w-28" />
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

function useAgentDetail(agentId: string) {
	const navigate = useNavigate()
	const agentsQuery = useListAgents()
	const permissions = agentsQuery.data?.data.agents.find(({ id }) => id === agentId)?.permissions
	const canRead = permissions?.includes("agents:read") ?? false
	const canDelete = permissions?.includes("agents:delete") ?? false
	const agentQuery = useGetAgent(agentId, { query: { enabled: canRead } })
	const embedsQuery = useListEmbeds({ agentId }, { query: { enabled: canDelete } })
	const client = useQueryClient()
	useEffect(() => {
		if (agentsQuery.data && !canRead) {
			clearAgentContent(client)
			void navigate({ to: "/dashboard/agents", replace: true, ignoreBlocker: true })
		}
	}, [agentsQuery.data, canRead, client, navigate])
	return {
		agentsQuery,
		agentQuery,
		embedsQuery,
		agent: agentQuery.data?.data.agent,
		canRead,
		canManage: permissions?.includes("agents:manage") ?? false,
		canDelete,
	}
}

function useAgentTab() {
	const { tab = "configuration" } = Route.useSearch()
	const navigate = Route.useNavigate()
	return {
		tab,
		setTab: (value: AgentTab) =>
			void navigate({ search: (prev) => ({ ...prev, tab: value }), replace: true, resetScroll: false }),
	}
}

function useAgentSettingsForm(agentId: string, agent: Agent | undefined) {
	const {
		register,
		handleSubmit,
		reset,
		setFocus,
		control,
		formState: { errors, isDirty },
	} = useForm<AgentFormValues>({
		resolver: zodResolver(agentFormSchema),
		defaultValues: { name: "", systemPrompt: "" },
	})
	const [editedTerms, setEditedTerms] = useState<{ agentId: string; terms: string[] } | null>(null)
	useEffect(() => {
		// keepDirtyValues so a background refetch never discards the operator's typing.
		if (agent) reset({ name: agent.name, systemPrompt: agent.systemPrompt }, { keepDirtyValues: true })
	}, [agent, reset])
	const savedTerms = agent?.wordBlacklist ?? []
	const terms = editedTerms?.agentId === agentId ? editedTerms.terms : savedTerms
	const termsChanged = terms.length !== savedTerms.length || terms.some((term, index) => term !== savedTerms[index])
	const dirtyGuard = useDirtyFormGuard(isDirty || termsChanged)
	const nameValue = useWatch({ control, name: "name" })
	const promptValue = useWatch({ control, name: "systemPrompt" })
	return {
		register,
		handleSubmit,
		reset,
		setFocus,
		control,
		errors,
		nameValue,
		promptValue,
		terms,
		dirty: isDirty || termsChanged,
		dirtyGuard,
		clearEditedTerms: () => setEditedTerms(null),
		updateTerms: (next: string[]) => setEditedTerms({ agentId, terms: next }),
	}
}

function agentSaveError(caught: unknown, t: (key: string) => string): string {
	const status = (caught as UpdateAgentMutationError).status
	if (status === CONFLICT_STATUS) return t("agents.nameConflict")
	if (status === FORBIDDEN_STATUS) return t("agents.manageForbidden")
	if (status === NOT_FOUND_STATUS) return t("agentConfig.wasDeleted")
	return t("agents.saveFailed")
}

function useAgentSave(props: {
	agentId: string
	canManage: boolean
	terms: string[]
	reset: (values: AgentFormValues) => void
	refetch: () => Promise<unknown>
	onSaved: () => void
}) {
	const { t } = useTranslation()
	const updateAgent = useUpdateAgent()
	const [saved, setSaved] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)

	async function onValid(values: AgentFormValues) {
		if (!props.canManage) return
		setFormError(null)
		setSaved(false)
		try {
			const result = await updateAgent.mutateAsync({
				agentId: props.agentId,
				data: { name: values.name, systemPrompt: values.systemPrompt, wordBlacklist: props.terms },
			})
			const updated = result.data.agent
			props.reset({ name: updated.name, systemPrompt: updated.systemPrompt })
			await props.refetch()
			props.onSaved()
			setSaved(true)
		} catch (caught) {
			setFormError(agentSaveError(caught, t))
		}
	}

	return { saved, setSaved, formError, onValid, pending: updateAgent.isPending }
}

function AgentNameField(props: {
	register: UseFormRegister<AgentFormValues>
	errors: FieldErrors<AgentFormValues>
	value: string
	canManage: boolean
	onEdit: () => void
}) {
	const { t } = useTranslation()
	return (
		<div className="space-y-2">
			<Label htmlFor="config-name">{t("agentFields.name")}</Label>
			<Input
				id="config-name"
				placeholder={t("agentFields.namePlaceholder")}
				readOnly={!props.canManage}
				aria-invalid={props.errors.name ? true : undefined}
				aria-describedby={`config-name-limit${props.errors.name ? " config-name-error" : ""}`}
				{...props.register("name", { onChange: props.onEdit })}
			/>
			<p id="config-name-limit" className="text-muted-foreground text-xs">
				{t("agentFields.characterLimit", { used: props.value.length, max: AGENT_NAME_MAX_LENGTH })}
			</p>
			{props.errors.name && (
				<p id="config-name-error" className="text-destructive text-xs" role="alert">
					{props.errors.name.type === "too_big"
						? t("agentFields.nameTooLong", { max: AGENT_NAME_MAX_LENGTH })
						: t("agentFields.nameRequired")}
				</p>
			)}
		</div>
	)
}

function AgentPromptField(props: {
	register: UseFormRegister<AgentFormValues>
	errors: FieldErrors<AgentFormValues>
	value: string
	canManage: boolean
	onEdit: () => void
}) {
	const { t } = useTranslation()
	return (
		<div className="space-y-2">
			<Label htmlFor="config-system-prompt">{t("agentFields.systemPrompt")}</Label>
			<Textarea
				id="config-system-prompt"
				placeholder={t("agentFields.systemPromptPlaceholder")}
				rows={5}
				readOnly={!props.canManage}
				aria-invalid={props.errors.systemPrompt ? true : undefined}
				aria-describedby={`config-system-prompt-limit${props.errors.systemPrompt ? " config-system-prompt-error" : ""}`}
				{...props.register("systemPrompt", { onChange: props.onEdit })}
			/>
			<p id="config-system-prompt-limit" className="text-muted-foreground text-xs">
				{t("agentFields.characterLimit", { used: props.value.length, max: SYSTEM_PROMPT_MAX_LENGTH })}
			</p>
			{props.errors.systemPrompt && (
				<p id="config-system-prompt-error" className="text-destructive text-xs" role="alert">
					{props.errors.systemPrompt.type === "too_big"
						? t("agentFields.systemPromptTooLong", { max: SYSTEM_PROMPT_MAX_LENGTH })
						: t("agentFields.systemPromptRequired")}
				</p>
			)}
		</div>
	)
}

function AgentSettingsCard(props: {
	agentId: string
	agent: Agent
	canManage: boolean
	refetch: () => Promise<unknown>
}) {
	const { t } = useTranslation()
	const form = useAgentSettingsForm(props.agentId, props.agent)
	const save = useAgentSave({
		agentId: props.agentId,
		canManage: props.canManage,
		terms: form.terms,
		reset: form.reset,
		refetch: props.refetch,
		onSaved: form.clearEditedTerms,
	})
	const markEdited = () => save.setSaved(false)

	return (
		<Card>
			<CardHeader>
				<CardTitle level={2}>{t("agentConfig.cardTitle")}</CardTitle>
				{props.canManage && <CardDescription>{t("agentConfig.cardDescription")}</CardDescription>}
			</CardHeader>
			<CardContent>
				<form
					onSubmit={form.handleSubmit(save.onValid, (errors) => form.setFocus(errors.name ? "name" : "systemPrompt"))}
					className="space-y-4"
				>
					{save.formError && (
						<p role="alert" className="text-destructive text-sm">
							{save.formError}
						</p>
					)}
					<AgentNameField
						register={form.register}
						errors={form.errors}
						value={form.nameValue}
						canManage={props.canManage}
						onEdit={markEdited}
					/>
					<AgentPromptField
						register={form.register}
						errors={form.errors}
						value={form.promptValue}
						canManage={props.canManage}
						onEdit={markEdited}
					/>
					<div className="space-y-2">
						<Label htmlFor={props.canManage ? "config-blacklist" : undefined}>{t("agentFields.wordBlacklist")}</Label>
						<BlacklistTermsEditor
							id="config-blacklist"
							value={form.terms}
							onChange={(next) => {
								markEdited()
								form.updateTerms(next)
							}}
							disabled={!props.canManage}
						/>
					</div>
					{props.canManage && (
						<FormActions status={save.saved && !form.dirty ? t("agentConfig.saved") : undefined}>
							<Button type="submit" disabled={save.pending || !form.dirty}>
								{save.pending ? t("agentConfig.saving") : t("agentConfig.save")}
							</Button>
						</FormActions>
					)}
				</form>
			</CardContent>
			{form.dirtyGuard}
		</Card>
	)
}

type AgentDeleteDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	pending: boolean
	error: string | undefined
	onConfirm: () => void
	agentName: string
}

function AgentDeleteDialog(props: AgentDeleteDialogProps) {
	const { t } = useTranslation()
	return (
		<ConfirmDialog
			open={props.open}
			onOpenChange={props.onOpenChange}
			title={t("agentConfig.deleteTitle")}
			description={t("agentConfig.deletePrompt", { name: props.agentName })}
			cancelLabel={t("agentConfig.cancel")}
			confirmLabel={t("agentConfig.deleteConfirm")}
			pendingLabel={t("agentConfig.deleting")}
			pending={props.pending}
			error={props.error}
			typeToConfirm={{
				value: props.agentName,
				label: t("agentConfig.confirmLabel", { name: props.agentName }),
				placeholder: props.agentName,
			}}
			onConfirm={props.onConfirm}
		/>
	)
}

function AgentDeleteCard({ agentId, agent, embedsQuery }: { agentId: string; agent: Agent; embedsQuery: EmbedsQuery }) {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const deleteAgent = useDeleteAgent()
	const embedCount = embedsQuery.data?.data.embeds.length ?? 0
	const embedsBlockDeletion = embedsQuery.isPending || embedCount > 0
	const [deleteError, setDeleteError] = useState<string | null>(null)
	const [deleteOpen, setDeleteOpen] = useState(false)

	async function onConfirmDelete() {
		setDeleteError(null)
		try {
			await deleteAgent.mutateAsync({ agentId })
			await navigate({ to: "/dashboard/agents", ignoreBlocker: true })
		} catch (caught) {
			if ((caught as DeleteAgentMutationError).status === NOT_FOUND_STATUS) {
				setDeleteError(t("agentConfig.wasDeleted"))
			} else {
				setDeleteError(getProblemMessage(caught, t, t("agents.deleteFailed")))
				void embedsQuery.refetch()
			}
		}
	}

	return (
		<DangerZone title={t("agentConfig.dangerZone")}>
			<DangerZoneRow
				title={t("agentConfig.deleteAgent")}
				description={
					<>
						<p>{t("agentConfig.dangerDescription")}</p>
						{embedCount > 0 ? (
							<p className="text-destructive">
								{t("agentConfig.deleteBlockedByEmbeds", { count: embedCount })}{" "}
								<Link
									to="/dashboard/agent/$agentId"
									params={{ agentId }}
									search={{ tab: "embeds" }}
									className="underline underline-offset-2"
								>
									{t("agentConfig.manageEmbeds")}
								</Link>
							</p>
						) : null}
					</>
				}
				action={
					<Button
						variant="destructive"
						disabled={embedsBlockDeletion}
						onClick={() => {
							deleteAgent.reset()
							setDeleteError(null)
							setDeleteOpen(true)
						}}
					>
						<Trash2 className="size-4" />
						{t("agentConfig.deleteAgent")}
					</Button>
				}
			/>
			<AgentDeleteDialog
				open={deleteOpen}
				onOpenChange={(next) => {
					setDeleteOpen(next)
					if (!next) {
						setDeleteError(null)
						deleteAgent.reset()
					}
				}}
				pending={deleteAgent.isPending}
				error={deleteError ?? undefined}
				onConfirm={() => void onConfirmDelete()}
				agentName={agent.name}
			/>
		</DangerZone>
	)
}

function EmbedCreateButton({ pending, onCreate }: { pending: boolean; onCreate: () => void }) {
	const { t } = useTranslation()
	return (
		<FloatingActionButton onClick={onCreate} disabled={pending}>
			<Plus />
			{pending ? t("embedSetup.creating") : t("embedSetup.createEmbed")}
		</FloatingActionButton>
	)
}

function AgentEmbedCard({ embed, canManage }: { embed: Embed; canManage: boolean }) {
	return (
		<Card variant="interactive" className="relative h-full">
			<CardHeader>
				<CardName>{embed.name}</CardName>
				<CardDescription>
					{isSupportedLanguage(embed.appearance.language)
						? supportedLanguages[embed.appearance.language]
						: embed.appearance.language}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-1.5" aria-hidden="true">
						{LIGHT_PALETTE_KEYS.map((key) => (
							<span
								key={key}
								className="size-4 rounded-full border"
								style={{ backgroundColor: embed.appearance.light[key] }}
							/>
						))}
					</div>
					<div className="relative z-10 w-fit">
						<EmbedEnabledSwitch embed={embed} disabled={!canManage} />
					</div>
				</div>
			</CardContent>
			<CardLink
				render={
					<Link to="/dashboard/embeds/$embedId" params={{ embedId: embed.id }} search={{ colorTab: undefined }} />
				}
				aria-label={embed.name}
			/>
		</Card>
	)
}

function AgentEmbedsSkeleton() {
	const { t } = useTranslation()
	return (
		<div className="grid gap-4 md:grid-cols-2">
			<output className="sr-only">{t("embedSetup.loading")}</output>
			{Array.from({ length: 2 }, (_, index) => (
				<Card key={index}>
					<CardHeader>
						<Skeleton className="h-5 w-32 max-w-full" />
						<Skeleton className="h-4 w-24" />
					</CardHeader>
					<CardContent>
						<div className="flex items-center justify-between gap-2">
							<Skeleton className="h-4 w-28" />
							<Skeleton className="h-5 w-10" />
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	)
}

function AgentEmbedsContent(props: {
	embeds: Embed[] | undefined
	isLoading: boolean
	isError: boolean
	error: unknown
	refetch: () => Promise<unknown>
	canManage: boolean
	creating: boolean
	onCreate: () => void
}) {
	const { t } = useTranslation()
	if (props.isLoading) return <AgentEmbedsSkeleton />
	if (props.isError) {
		return (
			<ProblemAlert error={props.error} fallback={t("embedSetup.loadError")} onRetry={() => void props.refetch()} />
		)
	}
	if (!props.embeds?.length) {
		return (
			<EmptyState
				icon={CodeXml}
				title={t("embedSetup.emptyTitle")}
				description={props.canManage ? t("embedSetup.emptyDescriptionManager") : t("embedSetup.emptyDescriptionReader")}
				actions={props.canManage ? <EmbedCreateButton pending={props.creating} onCreate={props.onCreate} /> : undefined}
			/>
		)
	}
	return (
		<div className="grid gap-4 md:grid-cols-2">
			{props.embeds.map((embed) => (
				<AgentEmbedCard key={embed.id} embed={embed} canManage={props.canManage} />
			))}
		</div>
	)
}

function AgentEmbedsPanel({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const { data: embedsResponse, isLoading, isError, error, refetch } = useListEmbeds({ agentId })
	const embeds = embedsResponse?.data.embeds
	const createEmbed = useCreateEmbed()

	async function onCreate() {
		try {
			const result = await createEmbed.mutateAsync({
				data: {
					name: nextDefaultName(embeds?.map((embed) => embed.name) ?? [], t("embedSetup.defaultName")),
					agentId,
					appearance: EMBED_FORM_DEFAULTS,
				},
			})
			await navigate({
				to: "/dashboard/embeds/$embedId",
				params: { embedId: result.data.embed.id },
				search: { colorTab: undefined },
			})
			await queryClient.invalidateQueries({ queryKey: getListEmbedsQueryKey({ agentId }) })
		} catch {
			// Reported below from createEmbed.isError.
			return
		}
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">{t("embedSetup.agentPanelDescription")}</p>
				{canManage && <EmbedCreateButton pending={createEmbed.isPending} onCreate={() => void onCreate()} />}
			</div>
			{createEmbed.isError && <ProblemAlert message={t("embedSetup.createError")} onRetry={() => void onCreate()} />}
			<AgentEmbedsContent
				embeds={embeds}
				isLoading={isLoading}
				isError={isError}
				error={error}
				refetch={refetch}
				canManage={canManage}
				creating={createEmbed.isPending}
				onCreate={() => void onCreate()}
			/>
		</div>
	)
}

function AgentConfigurationTab(props: {
	agentId: string
	agent: Agent
	canManage: boolean
	canDelete: boolean
	embedsQuery: EmbedsQuery
	refetch: () => Promise<unknown>
}) {
	return (
		<div className="space-y-6">
			<AgentSettingsCard
				agentId={props.agentId}
				agent={props.agent}
				canManage={props.canManage}
				refetch={props.refetch}
			/>
			{props.canDelete && (
				<AgentDeleteCard agentId={props.agentId} agent={props.agent} embedsQuery={props.embedsQuery} />
			)}
		</div>
	)
}

function AgentDetailTabs(props: {
	agentId: string
	agent: Agent
	canManage: boolean
	canDelete: boolean
	embedsQuery: EmbedsQuery
	tab: AgentTab
	setTab: (tab: AgentTab) => void
	refetch: () => Promise<unknown>
}) {
	const { t } = useTranslation()
	return (
		<Tabs value={props.tab} onValueChange={(value) => isAgentTab(value) && props.setTab(value)}>
			<TabsList>
				<TabsTrigger value="configuration">{t("agentConfig.tabConfiguration")}</TabsTrigger>
				<TabsTrigger value="context">{t("agentConfig.tabContext")}</TabsTrigger>
				<TabsTrigger value="embeds">{t("agentConfig.tabEmbeds")}</TabsTrigger>
				<TabsTrigger value="mcp">{t("agentConfig.tabMcp")}</TabsTrigger>
				{props.canManage && <TabsTrigger value="test-chat">{t("agentConfig.tabTestChat")}</TabsTrigger>}
			</TabsList>
			<TabsContent value="configuration" keepMounted>
				<AgentConfigurationTab
					agentId={props.agentId}
					agent={props.agent}
					canManage={props.canManage}
					canDelete={props.canDelete}
					embedsQuery={props.embedsQuery}
					refetch={props.refetch}
				/>
			</TabsContent>
			<TabsContent value="context">
				<AgentFilesCard agentId={props.agentId} canManage={props.canManage} />
			</TabsContent>
			<TabsContent value="embeds">
				<AgentEmbedsPanel agentId={props.agentId} canManage={props.canManage} />
			</TabsContent>
			<TabsContent value="mcp">
				<McpConnectionsCard agentId={props.agentId} canManage={props.canManage} />
			</TabsContent>
			{props.canManage && (
				<TabsContent value="test-chat">
					<TestChatCard agentId={props.agentId} />
				</TabsContent>
			)}
		</Tabs>
	)
}

function AgentConfigPage() {
	const { t } = useTranslation()
	const { agentId } = Route.useParams()
	const { tab, setTab } = useAgentTab()
	const { agentsQuery, agentQuery, embedsQuery, agent, canRead, canManage, canDelete } = useAgentDetail(agentId)

	if (agentsQuery.isPending || (canRead && agentQuery.isPending)) {
		return <AgentConfigSkeleton label={t("agentConfig.loading")} />
	}
	if (agentsQuery.isError || (canRead && agentQuery.isError)) {
		return (
			<div className="space-y-6">
				<BackLink t={t} />
				<ProblemAlert
					error={agentsQuery.error ?? agentQuery.error}
					onRetry={() => {
						if (agentsQuery.isError) void agentsQuery.refetch()
						if (canRead) void agentQuery.refetch()
					}}
				/>
			</div>
		)
	}
	if (!canRead) return null
	if (!agent) {
		return (
			<div className="space-y-6">
				<BackLink t={t} />
				<p className="text-muted-foreground">{t("agents.loadFailed")}</p>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<BackLink t={t} />
			<PageHeader title={agent.name} description={canManage ? t("agentConfig.subheading") : undefined} />
			<AgentDetailTabs
				agentId={agentId}
				agent={agent}
				canManage={canManage}
				canDelete={canDelete}
				embedsQuery={embedsQuery}
				tab={tab}
				setTab={setTab}
				refetch={agentQuery.refetch}
			/>
		</div>
	)
}

function BackLink({ t }: { t: (key: string) => string }) {
	return (
		<Button render={<Link to="/dashboard/agents" />} nativeButton={false} variant="ghost" className="-ml-2">
			<ArrowLeft className="size-4" />
			{t("agentConfig.backToAgents")}
		</Button>
	)
}
