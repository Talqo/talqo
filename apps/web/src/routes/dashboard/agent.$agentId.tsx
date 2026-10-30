import {
	type DeleteAgentMutationError,
	type UpdateAgentMutationError,
	useDeleteAgent,
	useGetAgent,
	useUpdateAgent,
} from "@/api/generated/agent/agent.ts"
import { getListEmbedsQueryKey, useCreateEmbed, useListEmbeds } from "@/api/generated/embed/embed.ts"
import { useGetAgentAccess, useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { ProblemAlert } from "@/components/problem-alert"
import { AgentAccessCard } from "@/features/agents/agent-access-card"
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
import { getProblemMessage } from "@/lib/problem-message"
import { retryUnlessClientError } from "@/lib/query-retry"
import { useDirtyFormGuard } from "@/lib/use-dirty-form-guard"
import { zodResolver } from "@hookform/resolvers/zod"
import { isSupportedLanguage, supportedLanguages } from "@talqo/shared/languages"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { CardLink } from "@talqo/ui/components/card-link"
import { CardName } from "@talqo/ui/components/card-name"
import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
import { DangerZone, DangerZoneRow } from "@talqo/ui/components/danger-zone"
import { FormActions } from "@talqo/ui/components/form-actions"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@talqo/ui/components/tabs"
import { Textarea } from "@talqo/ui/components/textarea"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { type FieldErrors, useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { EmbedEnabledSwitch } from "./-embed-enabled-switch"

const AGENT_TABS = ["configuration", "context", "embeds", "mcp"] as const
const LIGHT_PALETTE_KEYS = ["primary", "background", "surface", "text", "textOnPrimary"] as const
type AgentTab = (typeof AGENT_TABS)[number]

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

function AgentConfigPage() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const { agentId } = Route.useParams()
	const { tab = "configuration" } = Route.useSearch()
	const setTab = Route.useNavigate()
	const globalPermissions = useGetMyPermissions().data?.data.permissions
	const permissionsQuery = useGetAgentAccess(agentId, { query: { retry: retryUnlessClientError } })
	const permissions = permissionsQuery.data?.data.permissions
	const canRead = permissions?.includes("agents:read") ?? false
	const agentQuery = useGetAgent(agentId, { query: { enabled: canRead } })
	const agent = agentQuery.data?.data.agent
	const { error, isLoading } = agentQuery
	const updateAgent = useUpdateAgent()
	const deleteAgent = useDeleteAgent()

	const [editedTerms, setEditedTerms] = useState<{ agentId: string; terms: string[] } | null>(null)
	const [saved, setSaved] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)
	const [deleteError, setDeleteError] = useState<string | null>(null)
	const [deleteOpen, setDeleteOpen] = useState(false)
	const [accessDirty, setAccessDirty] = useState(false)

	const canManage = permissions?.includes("agents:manage") ?? false
	const canDelete = permissions?.includes("agents:delete") ?? false
	const canManageAccess = canRead && (globalPermissions?.includes("roles:manage") ?? false)
	const embedsQuery = useListEmbeds({ agentId }, { query: { enabled: canDelete } })
	const embedCount = embedsQuery.data?.data.embeds.length ?? 0
	const embedsBlockDeletion = embedsQuery.isPending || embedCount > 0
	const client = useQueryClient()
	useEffect(() => {
		if (permissionsQuery.error?.status === NOT_FOUND_STATUS || (permissionsQuery.data && !canRead)) {
			clearAgentContent(client)
			void navigate({ to: "/dashboard/agents", replace: true, ignoreBlocker: true })
		}
	}, [permissionsQuery.error, permissionsQuery.data, canRead, client, navigate])

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

	useEffect(() => {
		if (agent) {
			reset({ name: agent.name, systemPrompt: agent.systemPrompt })
		}
	}, [agent, reset])
	const savedTerms = agent?.wordBlacklist ?? []
	const terms = editedTerms?.agentId === agentId ? editedTerms.terms : savedTerms
	const termsChanged = terms.length !== savedTerms.length || terms.some((term, index) => term !== savedTerms[index])
	const dirty = isDirty || termsChanged
	const dirtyGuard = useDirtyFormGuard(dirty || accessDirty)
	const nameValue = useWatch({ control, name: "name" })
	const promptValue = useWatch({ control, name: "systemPrompt" })

	function onInvalid(formErrors: FieldErrors<AgentFormValues>) {
		setFocus(formErrors.name ? "name" : "systemPrompt")
	}

	async function onValid(values: AgentFormValues) {
		if (!canManage) return
		setFormError(null)
		setSaved(false)
		try {
			const result = await updateAgent.mutateAsync({
				agentId,
				data: { name: values.name, systemPrompt: values.systemPrompt, wordBlacklist: terms },
			})
			const updated = result.data.agent
			reset({ name: updated.name, systemPrompt: updated.systemPrompt })
			await agentQuery.refetch()
			setEditedTerms(null)
			setSaved(true)
		} catch (caught) {
			const status = (caught as UpdateAgentMutationError).status
			if (status === CONFLICT_STATUS) {
				setFormError(t("agents.nameConflict"))
			} else if (status === FORBIDDEN_STATUS) {
				setFormError(t("agents.manageForbidden"))
			} else if (status === NOT_FOUND_STATUS) {
				setFormError(t("agentConfig.wasDeleted"))
			} else {
				setFormError(t("agents.saveFailed"))
			}
		}
	}

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

	if (isLoading || permissionsQuery.isPending) {
		return <AgentConfigSkeleton label={t("agentConfig.loading")} />
	}
	if (permissionsQuery.isError || (canRead && agentQuery.isError)) {
		return (
			<div className="space-y-6">
				<BackLink t={t} />
				<ProblemAlert
					error={permissionsQuery.error ?? agentQuery.error}
					onRetry={() => {
						void permissionsQuery.refetch()
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
				<p className="text-muted-foreground">
					{error?.status === NOT_FOUND_STATUS ? t("agentConfig.notFound") : t("agents.loadFailed")}
				</p>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<BackLink t={t} />

			<PageHeader title={agent.name} description={canManage ? t("agentConfig.subheading") : undefined} />
			{dirtyGuard}

			<Tabs
				value={tab}
				onValueChange={(value) => {
					if (isAgentTab(value)) {
						void setTab({ search: (prev) => ({ ...prev, tab: value }), replace: true, resetScroll: false })
					}
				}}
			>
				<TabsList>
					<TabsTrigger value="configuration">{t("agentConfig.tabConfiguration")}</TabsTrigger>
					<TabsTrigger value="context">{t("agentConfig.tabContext")}</TabsTrigger>
					<TabsTrigger value="embeds">{t("agentConfig.tabEmbeds")}</TabsTrigger>
					<TabsTrigger value="mcp">{t("agentConfig.tabMcp")}</TabsTrigger>
				</TabsList>
				<TabsContent value="configuration" keepMounted>
					<div className="space-y-6">
						<Card>
							<CardHeader>
								<CardTitle>{t("agentConfig.cardTitle")}</CardTitle>
								{canManage && <CardDescription>{t("agentConfig.cardDescription")}</CardDescription>}
							</CardHeader>
							<CardContent>
								<form onSubmit={handleSubmit(onValid, onInvalid)} className="space-y-4">
									{formError && (
										<p role="alert" className="text-destructive text-sm">
											{formError}
										</p>
									)}
									<div className="space-y-2">
										<Label htmlFor="config-name">{t("agentFields.name")}</Label>
										<Input
											id="config-name"
											placeholder={t("agentFields.namePlaceholder")}
											readOnly={!canManage}
											aria-invalid={errors.name ? true : undefined}
											aria-describedby={`config-name-limit${errors.name ? " config-name-error" : ""}`}
											{...register("name", { onChange: () => setSaved(false) })}
										/>
										<p id="config-name-limit" className="text-muted-foreground text-xs">
											{t("agentFields.characterLimit", {
												used: nameValue.length,
												max: AGENT_NAME_MAX_LENGTH,
											})}
										</p>
										{errors.name && (
											<p id="config-name-error" className="text-destructive text-xs" role="alert">
												{errors.name.type === "too_big"
													? t("agentFields.nameTooLong", { max: AGENT_NAME_MAX_LENGTH })
													: t("agentFields.nameRequired")}
											</p>
										)}
									</div>
									<div className="space-y-2">
										<Label htmlFor="config-system-prompt">{t("agentFields.systemPrompt")}</Label>
										<Textarea
											id="config-system-prompt"
											placeholder={t("agentFields.systemPromptPlaceholder")}
											rows={5}
											readOnly={!canManage}
											aria-invalid={errors.systemPrompt ? true : undefined}
											aria-describedby={`config-system-prompt-limit${errors.systemPrompt ? " config-system-prompt-error" : ""}`}
											{...register("systemPrompt", { onChange: () => setSaved(false) })}
										/>
										<p id="config-system-prompt-limit" className="text-muted-foreground text-xs">
											{t("agentFields.characterLimit", {
												used: promptValue.length,
												max: SYSTEM_PROMPT_MAX_LENGTH,
											})}
										</p>
										{errors.systemPrompt && (
											<p id="config-system-prompt-error" className="text-destructive text-xs" role="alert">
												{errors.systemPrompt.type === "too_big"
													? t("agentFields.systemPromptTooLong", { max: SYSTEM_PROMPT_MAX_LENGTH })
													: t("agentFields.systemPromptRequired")}
											</p>
										)}
									</div>
									<div className="space-y-2">
										<Label htmlFor={canManage ? "config-blacklist" : undefined}>{t("agentFields.wordBlacklist")}</Label>
										<BlacklistTermsEditor
											id="config-blacklist"
											value={terms}
											onChange={(next) => {
												setSaved(false)
												setEditedTerms({ agentId, terms: next })
											}}
											disabled={!canManage}
										/>
									</div>
									{canManage && (
										<FormActions status={saved && !dirty ? t("agentConfig.saved") : undefined}>
											<Button type="submit" disabled={updateAgent.isPending || !dirty}>
												{updateAgent.isPending ? t("agentConfig.saving") : t("agentConfig.save")}
											</Button>
										</FormActions>
									)}
								</form>
							</CardContent>
						</Card>
						{canManageAccess && permissions && (
							<AgentAccessCard
								key={agentId}
								agentId={agentId}
								onDirtyChange={setAccessDirty}
								permissions={permissions}
							/>
						)}

						{canDelete && (
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
								<ConfirmDialog
									open={deleteOpen}
									onOpenChange={(next) => {
										setDeleteOpen(next)
										if (!next) {
											setDeleteError(null)
											deleteAgent.reset()
										}
									}}
									title={t("agentConfig.deleteTitle")}
									description={t("agentConfig.deletePrompt", { name: agent.name })}
									cancelLabel={t("agentConfig.cancel")}
									confirmLabel={t("agentConfig.deleteConfirm")}
									pendingLabel={t("agentConfig.deleting")}
									pending={deleteAgent.isPending}
									error={deleteError ?? undefined}
									typeToConfirm={{
										value: agent.name,
										label: t("agentConfig.confirmLabel", { name: agent.name }),
										placeholder: agent.name,
									}}
									onConfirm={() => void onConfirmDelete()}
								/>
							</DangerZone>
						)}
					</div>
				</TabsContent>
				<TabsContent value="context">
					<AgentFilesCard agentId={agentId} canManage={canManage} />
				</TabsContent>
				<TabsContent value="embeds">
					<AgentEmbedsPanel agentId={agentId} canManage={canManage} />
				</TabsContent>
				<TabsContent value="mcp">
					<McpConnectionsCard agentId={agentId} canManage={canManage} />
				</TabsContent>
			</Tabs>
		</div>
	)
}

function AgentEmbedsPanel({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const { data: embedsResponse, isLoading, isError } = useListEmbeds({ agentId })
	const embeds = embedsResponse?.data.embeds
	const createEmbed = useCreateEmbed()

	async function onCreate() {
		try {
			const result = await createEmbed.mutateAsync({
				data: { name: t("embedSetup.defaultName"), agentId, appearance: EMBED_FORM_DEFAULTS },
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
				{canManage && (
					<Button onClick={onCreate} disabled={createEmbed.isPending}>
						<Plus className="size-4" />
						{createEmbed.isPending ? t("embedSetup.creating") : t("embedSetup.createEmbed")}
					</Button>
				)}
			</div>
			{createEmbed.isError && (
				<p role="alert" className="text-destructive text-sm">
					{t("embedSetup.createError")}
				</p>
			)}

			{isLoading ? (
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
			) : isError ? (
				<p role="alert" className="text-destructive">
					{t("embedSetup.loadError")}
				</p>
			) : !embeds?.length ? (
				<p className="text-muted-foreground">
					{canManage ? t("embedSetup.noEmbeds") : t("embedSetup.noEmbedsReadOnly")}
				</p>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{embeds.map((embed) => (
						<Card key={embed.id} variant="interactive" className="relative h-full">
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
									<Link
										to="/dashboard/embeds/$embedId"
										params={{ embedId: embed.id }}
										search={{ colorTab: undefined }}
									/>
								}
								aria-label={embed.name}
							/>
						</Card>
					))}
				</div>
			)}
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
