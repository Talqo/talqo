import {
	type DeleteAgentMutationError,
	type UpdateAgentMutationError,
	useDeleteAgent,
	useGetAgent,
	useUpdateAgent,
} from "@/api/generated/agent/agent.ts"
import { getListEmbedsQueryKey, useCreateEmbed, useListEmbeds } from "@/api/generated/embed/embed.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { agentFormSchema, type AgentFormValues } from "@/features/agents/agent-schema"
import { BlacklistTermsEditor } from "@/features/agents/components/blacklist-terms-editor"
import { AgentFilesCard } from "@/features/context/agent-files-card"
import { EMBED_FORM_DEFAULTS } from "@/features/embeds/embed-appearance-form"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { zodResolver } from "@hookform/resolvers/zod"
import { isSupportedLanguage, supportedLanguages } from "@talqo/shared/languages"
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
import { ArrowLeft, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

const AGENT_TABS = ["configuration", "context", "embeds"] as const
const LIGHT_PALETTE_KEYS = ["primary", "background", "surface", "text", "textOnPrimary"] as const
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

	const [editedTerms, setEditedTerms] = useState<{ agentId: string; terms: string[] } | null>(null)
	const [saved, setSaved] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)
	const [deleteError, setDeleteError] = useState<string | null>(null)
	const [confirmation, setConfirmation] = useState("")
	const [confirmOpen, setConfirmOpen] = useState(false)

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
					<TabsTrigger value="context">{t("agentConfig.tabContext")}</TabsTrigger>
					<TabsTrigger value="embeds">{t("agentConfig.tabEmbeds")}</TabsTrigger>
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
				<TabsContent value="context">
					<AgentFilesCard agentId={agentId} canManage={canManage} />
				</TabsContent>
				<TabsContent value="embeds">
					<AgentEmbedsPanel agentId={agentId} canManage={canManage} />
				</TabsContent>
			</Tabs>
		</div>
	)
}

function AgentEmbedsPanel({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const { data: embedsResponse, isLoading, isError } = useListEmbeds({ agentId })
	const embeds = embedsResponse?.data.embeds
	const createEmbed = useCreateEmbed({
		mutation: {
			onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEmbedsQueryKey({ agentId }) }),
		},
	})
	const [dialogOpen, setDialogOpen] = useState(false)
	const [name, setName] = useState("")

	async function onCreate() {
		if (!name.trim()) {
			return
		}
		try {
			await createEmbed.mutateAsync({ data: { name: name.trim(), agentId, appearance: EMBED_FORM_DEFAULTS } })
		} catch {
			// Reported below from createEmbed.isError; the draft stays for a retry.
			return
		}
		setName("")
		setDialogOpen(false)
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">{t("embedSetup.agentPanelDescription")}</p>
				{canManage && (
					<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
						<DialogTrigger render={<Button />}>
							<Plus className="size-4" />
							{t("embedSetup.createEmbed")}
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>{t("embedSetup.createEmbed")}</DialogTitle>
								<DialogDescription>{t("embedSetup.createDescription")}</DialogDescription>
							</DialogHeader>
							<div className="space-y-2">
								<Label htmlFor="embed-name">{t("embedSetup.nameLabel")}</Label>
								<Input
									id="embed-name"
									placeholder={t("embedSetup.namePlaceholder")}
									value={name}
									onChange={(event) => setName(event.target.value)}
								/>
							</div>
							{createEmbed.isError && (
								<p role="alert" className="text-destructive text-sm">
									{t("embedSetup.createError")}
								</p>
							)}
							<DialogFooter>
								<Button onClick={onCreate} disabled={createEmbed.isPending || !name.trim()}>
									{createEmbed.isPending ? t("embedSetup.creating") : t("embedSetup.createEmbed")}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				)}
			</div>

			{isLoading ? (
				<p className="text-muted-foreground">{t("embedSetup.loading")}</p>
			) : isError ? (
				<p role="alert" className="text-destructive">
					{t("embedSetup.loadError")}
				</p>
			) : !embeds?.length ? (
				<p className="text-muted-foreground">{t("embedSetup.noEmbeds")}</p>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{embeds.map((embed) => (
						<Link
							key={embed.id}
							to="/dashboard/embeds/$embedId"
							params={{ embedId: embed.id }}
							search={{ colorTab: undefined }}
							className="group"
						>
							<Card className="group-hover:border-primary/40 h-full transition-colors">
								<CardHeader>
									<CardTitle>{embed.name}</CardTitle>
								</CardHeader>
								<CardContent className="flex items-center justify-between gap-2">
									<div className="flex items-center gap-1.5" aria-hidden="true">
										{LIGHT_PALETTE_KEYS.map((key) => (
											<span
												key={key}
												className="size-4 rounded-full border"
												style={{ backgroundColor: embed.appearance.light[key] }}
											/>
										))}
									</div>
									<span className="text-muted-foreground text-sm">
										{isSupportedLanguage(embed.appearance.language)
											? supportedLanguages[embed.appearance.language]
											: embed.appearance.language}
									</span>
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
