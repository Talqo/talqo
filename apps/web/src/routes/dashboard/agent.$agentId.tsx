import { ApiError, CONFLICT_STATUS, FORBIDDEN_STATUS, NOT_FOUND_STATUS } from "@/api/errors.ts"
import { PageHeader } from "@/components/page-header"
import { useAgent } from "@/features/agents/agent-query"
import { agentFormSchema, type AgentFormValues } from "@/features/agents/agent-schema"
import { BlacklistTermsEditor } from "@/features/agents/components/blacklist-terms-editor"
import { useDeleteAgent } from "@/features/agents/delete-agent-mutation"
import { useUpdateAgent } from "@/features/agents/update-agent-mutation"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { useMyPermissions } from "@/features/permissions/permissions-query"
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
} from "@talqo/ui/components/dialog"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Textarea } from "@talqo/ui/components/textarea"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/agent/$agentId")({
	component: AgentConfigPage,
})

function AgentConfigPage() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const { agentId } = Route.useParams()
	const { data: permissions, isLoading: permissionsLoading } = useMyPermissions()
	const { data: agent, error, isLoading } = useAgent(agentId)
	const updateAgent = useUpdateAgent()
	const deleteAgent = useDeleteAgent()

	const [terms, setTerms] = useState<string[]>([])
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
			setTerms(agent.wordBlacklist)
		}
	}, [agent, reset])

	async function onValid(values: AgentFormValues) {
		setFormError(null)
		setSaved(false)
		try {
			await updateAgent.mutateAsync({
				agentId,
				input: { name: values.name, systemPrompt: values.systemPrompt, wordBlacklist: terms },
			})
			setSaved(true)
		} catch (caught) {
			// Failed saves keep edits; only the message changes.
			if (caught instanceof ApiError && caught.status === CONFLICT_STATUS) {
				setFormError(t("agents.nameConflict"))
			} else if (caught instanceof ApiError && caught.status === FORBIDDEN_STATUS) {
				setFormError(t("agents.manageForbidden"))
			} else if (caught instanceof ApiError && caught.status === NOT_FOUND_STATUS) {
				setFormError(t("agentConfig.wasDeleted"))
			} else {
				setFormError(t("agents.saveFailed"))
			}
		}
	}

	async function onConfirmDelete() {
		setDeleteError(null)
		try {
			await deleteAgent.mutateAsync(agentId)
			await navigate({ to: "/dashboard/agents" })
		} catch (caught) {
			setDeleteError(
				caught instanceof ApiError && caught.status === NOT_FOUND_STATUS
					? t("agentConfig.wasDeleted")
					: t("agents.deleteFailed"),
			)
		}
	}

	if (isLoading || permissionsLoading) {
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
					{error instanceof ApiError && error.status === NOT_FOUND_STATUS
						? t("agentConfig.notFound")
						: t("agents.loadFailed")}
				</p>
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<BackLink t={t} />

			<PageHeader title={t("agentConfig.heading", { name: agent.name })} description={t("agentConfig.subheading")} />
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
								disabled={!canManage}
								aria-invalid={errors.systemPrompt ? true : undefined}
								{...register("systemPrompt")}
							/>
							{errors.systemPrompt && (
								<p className="text-destructive text-xs">{t("agentFields.systemPromptRequired")}</p>
							)}
						</div>
						<div className="space-y-2">
							<Label htmlFor="config-blacklist">{t("agentFields.wordBlacklist")}</Label>
							<BlacklistTermsEditor id="config-blacklist" value={terms} onChange={setTerms} disabled={!canManage} />
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
									<p className="text-muted-foreground text-xs">{t("agentConfig.confirmHelp", { name: agent.name })}</p>
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
