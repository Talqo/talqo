import {
	type DeleteAgentMutationError,
	type RefreshEmbedTokenMutationError,
	type UpdateAgentMutationError,
	useDeleteAgent,
	useGetAgent,
	useRefreshEmbedToken,
	useUpdateAgent,
} from "@/api/generated/agent/agent.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { getListWidgetsQueryKey, useCreateWidget, useListWidgets } from "@/api/generated/widget/widget.ts"
import { PageHeader } from "@/components/page-header"
import { agentFormSchema, type AgentFormValues } from "@/features/agents/agent-schema"
import { BlacklistTermsEditor } from "@/features/agents/components/blacklist-terms-editor"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { WIDGET_FORM_DEFAULTS } from "@/features/widgets/widget-appearance-form"
import { zodResolver } from "@hookform/resolvers/zod"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@talqo/ui/components/tabs"
import { Textarea } from "@talqo/ui/components/textarea"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

const AGENT_TABS = ["configuration", "widgets"] as const
type AgentTab = (typeof AGENT_TABS)[number]

function isAgentTab(value: unknown): value is AgentTab {
	return (AGENT_TABS as readonly unknown[]).includes(value)
}

export const Route = createFileRoute("/dashboard/agent/$agentId")({
	validateSearch: (search: Record<string, unknown>) => ({
		tab: isAgentTab(search.tab) ? search.tab : undefined,
	}),
	component: AgentConfigPage,
})

const CONFLICT_STATUS = 409
const FORBIDDEN_STATUS = 403
const NOT_FOUND_STATUS = 404

function AgentConfigPage() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const { agentId } = Route.useParams()
	const { tab = "configuration" } = Route.useSearch()
	const setTab = Route.useNavigate()
	const permissionsQuery = useGetMyPermissions()
	const permissions = permissionsQuery.data?.data.permissions
	const agentQuery = useGetAgent(agentId)
	const agent = agentQuery.data?.data.agent
	const { error, isLoading } = agentQuery
	const updateAgent = useUpdateAgent()
	const deleteAgent = useDeleteAgent()
	const refreshEmbedToken = useRefreshEmbedToken()

	const [editedTerms, setEditedTerms] = useState<{ agentId: string; terms: string[] } | null>(null)
	const [saved, setSaved] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)
	const [deleteError, setDeleteError] = useState<string | null>(null)
	const [confirmation, setConfirmation] = useState("")
	const [confirmOpen, setConfirmOpen] = useState(false)
	const [refreshOpen, setRefreshOpen] = useState(false)
	const [refreshError, setRefreshError] = useState<string | null>(null)

	const canRead = permissions?.includes("agents:read") ?? false
	const canManage = permissions?.includes("agents:manage") ?? false

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<AgentFormValues>({
		resolver: zodResolver(agentFormSchema),
		defaultValues: { name: "", systemPrompt: "" },
	})

	useEffect(() => {
		if (agent) {
			reset({ name: agent.name, systemPrompt: agent.systemPrompt })
		}
	}, [agent, reset])
	const terms = editedTerms?.agentId === agentId ? editedTerms.terms : (agent?.wordBlacklist ?? [])

	async function onValid(values: AgentFormValues) {
		setFormError(null)
		setSaved(false)
		try {
			await updateAgent.mutateAsync({
				agentId,
				data: { name: values.name, systemPrompt: values.systemPrompt, wordBlacklist: terms },
			})
			await agentQuery.refetch()
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

	async function onConfirmRefresh() {
		setRefreshError(null)
		try {
			await refreshEmbedToken.mutateAsync({ agentId })
			await agentQuery.refetch()
			setRefreshOpen(false)
		} catch (caught) {
			setRefreshError(
				(caught as RefreshEmbedTokenMutationError).status === NOT_FOUND_STATUS
					? t("agentConfig.wasDeleted")
					: t("agentConfig.refreshTokenFailed"),
			)
		}
	}

	async function onConfirmDelete() {
		setDeleteError(null)
		try {
			await deleteAgent.mutateAsync({ agentId })
			await navigate({ to: "/dashboard/agents" })
		} catch (caught) {
			setDeleteError(
				(caught as DeleteAgentMutationError).status === NOT_FOUND_STATUS
					? t("agentConfig.wasDeleted")
					: t("agents.deleteFailed"),
			)
		}
	}

	if (isLoading || permissionsQuery.isLoading) {
		return (
			<div className="mx-auto max-w-3xl">
				<p className="text-muted-foreground">{t("agentConfig.loading")}</p>
			</div>
		)
	}

	if (!canRead) {
		return (
			<div className="mx-auto max-w-3xl space-y-6">
				<BackLink t={t} />
				<AccessDenied />
			</div>
		)
	}

	if (!agent) {
		return (
			<div className="mx-auto max-w-3xl space-y-6">
				<BackLink t={t} />
				<p className="text-muted-foreground">
					{error?.status === NOT_FOUND_STATUS ? t("agentConfig.notFound") : t("agents.loadFailed")}
				</p>
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<BackLink t={t} />

			<PageHeader title={t("agentConfig.heading", { name: agent.name })} description={t("agentConfig.subheading")} />

			<Tabs
				value={tab}
				onValueChange={(value) => {
					if (isAgentTab(value)) {
						void setTab({ search: (prev) => ({ ...prev, tab: value }), replace: true })
					}
				}}
			>
				<TabsList>
					<TabsTrigger value="configuration">{t("agentConfig.tabConfiguration")}</TabsTrigger>
					<TabsTrigger value="widgets">{t("agentConfig.tabWidgets")}</TabsTrigger>
				</TabsList>
				<TabsContent value="configuration" className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>{t("agentConfig.cardTitle")}</CardTitle>
							<CardDescription>{t("agentConfig.cardDescription")}</CardDescription>
						</CardHeader>
						<CardContent>
							<form onSubmit={handleSubmit(onValid)} className="space-y-4">
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
										disabled={!canManage}
										aria-invalid={errors.name ? true : undefined}
										{...register("name", { onChange: () => setSaved(false) })}
									/>
									{errors.name && <p className="text-destructive text-xs">{t("agentFields.nameRequired")}</p>}
								</div>
								<div className="space-y-2">
									<Label htmlFor="config-system-prompt">{t("agentFields.systemPrompt")}</Label>
									<Textarea
										id="config-system-prompt"
										placeholder={t("agentFields.systemPromptPlaceholder")}
										rows={5}
										disabled={!canManage}
										aria-invalid={errors.systemPrompt ? true : undefined}
										{...register("systemPrompt", { onChange: () => setSaved(false) })}
									/>
									{errors.systemPrompt && (
										<p className="text-destructive text-xs">{t("agentFields.systemPromptRequired")}</p>
									)}
								</div>
								<div className="space-y-2">
									<Label htmlFor="config-blacklist">{t("agentFields.wordBlacklist")}</Label>
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
									<div className="flex items-center gap-3 pt-2">
										<Button type="submit" disabled={updateAgent.isPending}>
											{updateAgent.isPending ? t("agentConfig.saving") : t("agentConfig.save")}
										</Button>
										{saved && (
											<span role="status" className="text-muted-foreground text-sm">
												{t("agentConfig.saved")}
											</span>
										)}
									</div>
								)}
							</form>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{t("agentConfig.embedToken")}</CardTitle>
							<CardDescription>{t("agentConfig.embedTokenDescription")}</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="embed-token">{t("agentConfig.embedToken")}</Label>
								<Input id="embed-token" value={agent.embedToken} readOnly className="font-mono" />
							</div>
							{canManage && (
								<Dialog open={refreshOpen} onOpenChange={setRefreshOpen}>
									<Button variant="outline" onClick={() => setRefreshOpen(true)}>
										<RefreshCw className="size-4" />
										{t("agentConfig.refreshToken")}
									</Button>
									<DialogContent>
										<DialogHeader>
											<DialogTitle>{t("agentConfig.refreshTokenTitle")}</DialogTitle>
											<DialogDescription>{t("agentConfig.refreshTokenWarning")}</DialogDescription>
										</DialogHeader>
										{refreshError && (
											<p role="alert" className="text-destructive text-sm">
												{refreshError}
											</p>
										)}
										<DialogFooter>
											<Button variant="outline" onClick={() => setRefreshOpen(false)}>
												{t("agentConfig.cancel")}
											</Button>
											<Button variant="destructive" disabled={refreshEmbedToken.isPending} onClick={onConfirmRefresh}>
												{refreshEmbedToken.isPending ? t("agentConfig.refreshing") : t("agentConfig.refreshToken")}
											</Button>
										</DialogFooter>
									</DialogContent>
								</Dialog>
							)}
						</CardContent>
					</Card>

					{canManage && (
						// Card outlines come from ring-1, so the red goes on the ring, not a border.
						<Card className="ring-destructive">
							<CardHeader>
								<CardTitle>{t("agentConfig.dangerZone")}</CardTitle>
								<CardDescription>{t("agentConfig.dangerDescription")}</CardDescription>
							</CardHeader>
							<CardContent>
								<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
									<Button variant="destructive" onClick={() => setConfirmOpen(true)}>
										<Trash2 className="size-4" />
										{t("agentConfig.deleteAgent")}
									</Button>
									<DialogContent>
										<DialogHeader>
											<DialogTitle>{t("agentConfig.deleteTitle")}</DialogTitle>
											<DialogDescription>{t("agentConfig.deletePrompt", { name: agent.name })}</DialogDescription>
										</DialogHeader>
										{deleteError && (
											<p role="alert" className="text-destructive text-sm">
												{deleteError}
											</p>
										)}
										<div className="space-y-2">
											<Label htmlFor="delete-confirm" className="flex items-center gap-2">
												<span className="sr-only">{t("agentConfig.confirmLabel", { name: agent.name })}</span>
											</Label>
											<Input
												id="delete-confirm"
												value={confirmation}
												onChange={(event) => setConfirmation(event.target.value)}
												placeholder={agent.name}
												autoComplete="off"
											/>
											<p className="text-muted-foreground text-xs">
												{t("agentConfig.confirmHelp", { name: agent.name })}
											</p>
										</div>
										<DialogFooter>
											<Button variant="outline" onClick={() => setConfirmOpen(false)}>
												{t("agentConfig.cancel")}
											</Button>
											<Button
												variant="destructive"
												disabled={confirmation !== agent.name || deleteAgent.isPending}
												onClick={onConfirmDelete}
											>
												{deleteAgent.isPending ? t("agentConfig.deleting") : t("agentConfig.deleteConfirm")}
											</Button>
										</DialogFooter>
									</DialogContent>
								</Dialog>
							</CardContent>
						</Card>
					)}
				</TabsContent>
				<TabsContent value="widgets">
					<AgentWidgetsPanel agentId={agentId} canManage={canManage} />
				</TabsContent>
			</Tabs>
		</div>
	)
}

function AgentWidgetsPanel({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const { data: widgetsResponse, isLoading, isError } = useListWidgets({ agentId })
	const widgets = widgetsResponse?.data.widgets
	const createWidget = useCreateWidget({
		mutation: {
			onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWidgetsQueryKey({ agentId }) }),
		},
	})
	const [dialogOpen, setDialogOpen] = useState(false)
	const [name, setName] = useState("")

	async function onCreate() {
		if (!name.trim()) {
			return
		}
		try {
			await createWidget.mutateAsync({ data: { name: name.trim(), agentId, appearance: WIDGET_FORM_DEFAULTS } })
		} catch {
			// Reported below from createWidget.isError; the draft stays for a retry.
			return
		}
		setName("")
		setDialogOpen(false)
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">{t("widgetSetup.agentPanelDescription")}</p>
				{canManage && (
					<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
						<DialogTrigger render={<Button />}>
							<Plus className="size-4" />
							{t("widgetSetup.createWidget")}
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>{t("widgetSetup.createWidget")}</DialogTitle>
								<DialogDescription>{t("widgetSetup.createDescription")}</DialogDescription>
							</DialogHeader>
							<div className="space-y-2">
								<Label htmlFor="widget-name">{t("widgetSetup.nameLabel")}</Label>
								<Input
									id="widget-name"
									placeholder={t("widgetSetup.namePlaceholder")}
									value={name}
									onChange={(event) => setName(event.target.value)}
								/>
							</div>
							{createWidget.isError && (
								<p role="alert" className="text-destructive text-sm">
									{t("widgetSetup.createError")}
								</p>
							)}
							<DialogFooter>
								<Button onClick={onCreate} disabled={createWidget.isPending || !name.trim()}>
									{createWidget.isPending ? t("widgetSetup.creating") : t("widgetSetup.createWidget")}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				)}
			</div>

			{isLoading ? (
				<p className="text-muted-foreground">{t("widgetSetup.loading")}</p>
			) : isError ? (
				<p role="alert" className="text-destructive">
					{t("widgetSetup.loadError")}
				</p>
			) : !widgets?.length ? (
				<p className="text-muted-foreground">{t("widgetSetup.noWidgets")}</p>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{widgets.map((widget) => (
						<Link
							key={widget.id}
							to="/dashboard/widgets/$widgetId"
							params={{ widgetId: widget.id }}
							search={{ colorTab: undefined }}
							className="group"
						>
							<Card className="group-hover:border-primary/40 h-full transition-colors">
								<CardHeader>
									<CardTitle>{widget.name}</CardTitle>
								</CardHeader>
								<CardContent className="flex items-center gap-2">
									<span
										aria-hidden="true"
										className="size-4 rounded-full border"
										style={{ backgroundColor: widget.appearance.light.primary }}
									/>
									<span className="text-muted-foreground text-sm">{t("widgetSetup.openCustomization")}</span>
								</CardContent>
							</Card>
						</Link>
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
