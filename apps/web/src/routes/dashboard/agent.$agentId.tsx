import { PageHeader } from "@/components/page-header"
import { agentFormSchema, type AgentFormValues } from "@/features/agents/agent-schema"
import { useAgent, useUpdateAgent } from "@/features/agents/agents-query"
import { parseBlacklist } from "@/features/agents/blacklist"
import { useContextFiles, useDeleteContextFile, useUploadContextFiles } from "@/features/context/use-context-files"
import { zodResolver } from "@hookform/resolvers/zod"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Switch } from "@talqo/ui/components/switch"
import { Textarea } from "@talqo/ui/components/textarea"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft, FileText, Trash2, Upload } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/agent/$agentId")({
	component: AgentConfigPage,
})

const BYTES_PER_KB = 1024
// eslint-disable-next-line no-magic-numbers
const BYTES_PER_MB = 1024 * 1024

function AgentConfigPage() {
	const { t } = useTranslation()
	const { agentId } = Route.useParams()
	const { data: agent, isLoading } = useAgent(agentId)
	const updateAgent = useUpdateAgent()

	const [saved, setSaved] = useState(false)

	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const [dragging, setDragging] = useState(false)
	const [uploadError, setUploadError] = useState<string | null>(null)
	const contextFilesQuery = useContextFiles(agent?.contextId)
	const uploadFiles = useUploadContextFiles()
	const deleteFile = useDeleteContextFile()

	function startBatch(fileList: FileList | null) {
		if (!fileList?.length || !agent) return
		setUploadError(null)
		uploadFiles.mutate(
			{ contextId: agent.contextId, files: Array.from(fileList) },
			{
				onSuccess: ({ contextId, results }) => {
					// Write only when the id actually changed: an unchanged patch would still
					// produce a new agent object, re-run the form effect, and discard in-progress edits.
					if (contextId !== agent.contextId) updateAgent(agentId, { contextId })
					if (fileInputRef.current) fileInputRef.current.value = ""
					for (const result of results) {
						if (result.error) setUploadError(`${result.name}: ${result.error}`)
					}
				},
				onError: (error) => setUploadError(error instanceof Error ? error.message : String(error)),
			},
		)
	}

	function onDrop(event: React.DragEvent<HTMLDivElement>) {
		event.preventDefault()
		setDragging(false)
		startBatch(event.dataTransfer.files)
	}

	const {
		register,
		handleSubmit,
		reset,
		control,
		watch,
		formState: { errors },
	} = useForm<AgentFormValues>({
		resolver: zodResolver(agentFormSchema),
		defaultValues: { name: "", systemPrompt: "", wordBlacklist: "", active: false },
	})

	const active = watch("active")

	useEffect(() => {
		if (agent) {
			reset({
				name: agent.name,
				systemPrompt: agent.systemPrompt,
				wordBlacklist: agent.wordBlacklist.join(", "),
				active: agent.status === "active",
			})
		}
	}, [agent, reset])

	function onValid(values: AgentFormValues) {
		updateAgent(agentId, {
			name: values.name.trim(),
			systemPrompt: values.systemPrompt.trim(),
			wordBlacklist: parseBlacklist(values.wordBlacklist),
			status: values.active ? "active" : "paused",
		})
		setSaved(true)
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<Button render={<Link to="/dashboard/agents" />} nativeButton={false} variant="ghost" className="-ml-2">
				<ArrowLeft className="size-4" />
				{t("agentConfig.backToAgents")}
			</Button>

			{isLoading ? (
				<p className="text-muted-foreground">{t("agentConfig.loading")}</p>
			) : !agent ? (
				<p className="text-muted-foreground">{t("agentConfig.notFound")}</p>
			) : (
				<>
					<PageHeader
						title={t("agentConfig.heading", { name: agent.name })}
						description={t("agentConfig.subheading")}
					/>
					<Card>
						<CardHeader>
							<CardTitle>{t("agentConfig.cardTitle")}</CardTitle>
							<CardDescription>{t("agentConfig.cardDescription")}</CardDescription>
						</CardHeader>
						<CardContent>
							<form onSubmit={handleSubmit(onValid)} className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="config-name">{t("agentFields.name")}</Label>
									<Input
										id="config-name"
										placeholder={t("agentFields.namePlaceholder")}
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
										aria-invalid={errors.systemPrompt ? true : undefined}
										{...register("systemPrompt")}
									/>
									{errors.systemPrompt && (
										<p className="text-destructive text-xs">{t("agentFields.systemPromptRequired")}</p>
									)}
								</div>
								<div className="space-y-2">
									<Label htmlFor="config-blacklist">{t("agentFields.wordBlacklist")}</Label>
									<Input
										id="config-blacklist"
										placeholder={t("agentFields.blacklistPlaceholder")}
										{...register("wordBlacklist")}
									/>
									<p className="text-muted-foreground text-xs">{t("agentFields.blacklistHelp")}</p>
									{agent.wordBlacklist.length > 0 && (
										<div className="flex flex-wrap gap-1 pt-1">
											{agent.wordBlacklist.map((word) => (
												<Badge key={word} variant="outline">
													{word}
												</Badge>
											))}
										</div>
									)}
								</div>
								<div className="flex items-center gap-2">
									<Controller
										control={control}
										name="active"
										render={({ field }) => (
											<Switch id="config-status" checked={field.value} onCheckedChange={field.onChange} />
										)}
									/>
									<Label htmlFor="config-status">
										{t(active ? "agentFields.statusActive" : "agentFields.statusPaused")}
									</Label>
								</div>
								<div className="flex items-center gap-3 pt-2">
									<Button type="submit">{t("agentConfig.save")}</Button>
									{saved && <span className="text-muted-foreground text-sm">{t("agentConfig.saved")}</span>}
								</div>
							</form>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{t("agentFiles.cardTitle")}</CardTitle>
							<CardDescription>
								{contextFilesQuery.data
									? t("agentFiles.cardDescription", {
											maxSizeMB: Math.round(contextFilesQuery.data.maxSizeBytes / BYTES_PER_MB),
											maxNameLength: contextFilesQuery.data.maxNameLength,
										})
									: t("agentFiles.cardDescriptionLoading")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div
								role="button"
								tabIndex={uploadFiles.isPending ? -1 : 0}
								aria-disabled={uploadFiles.isPending}
								className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors ${
									dragging ? "border-primary bg-accent" : "border-input hover:border-ring hover:bg-accent/50"
								} ${uploadFiles.isPending ? "pointer-events-none opacity-60" : ""}`}
								onClick={() => fileInputRef.current?.click()}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault()
										fileInputRef.current?.click()
									}
								}}
								onDragOver={(event) => {
									event.preventDefault()
									setDragging(true)
								}}
								onDragLeave={() => setDragging(false)}
								onDrop={onDrop}
							>
								<input
									ref={fileInputRef}
									id="context-file-input"
									type="file"
									accept=".pdf,.txt,.md,.docx"
									multiple
									className="sr-only"
									disabled={uploadFiles.isPending}
									onChange={(event) => startBatch(event.target.files)}
								/>
								<Upload className="text-muted-foreground size-6" />
								<p className="text-sm font-medium">
									{uploadFiles.isPending ? t("agentFiles.uploading") : t("agentFiles.dropzone")}
								</p>
								<p className="text-muted-foreground text-xs">{t("agentFiles.dropzoneHint")}</p>
							</div>
							{uploadError && <p className="text-destructive text-xs">{uploadError}</p>}
							{contextFilesQuery.isLoading && agent.contextId && (
								<p className="text-muted-foreground text-sm">{t("agentFiles.loading")}</p>
							)}
							{contextFilesQuery.data && contextFilesQuery.data.files.length > 0 && (
								<ul className="divide-border divide-y rounded-md border">
									{contextFilesQuery.data.files.map((file) => (
										<li key={file.name} className="flex items-center justify-between gap-3 px-3 py-2">
											<div className="flex min-w-0 items-center gap-2">
												<FileText className="text-muted-foreground size-4 shrink-0" />
												<span className="truncate text-sm">{file.name}</span>
												<span className="text-muted-foreground shrink-0 text-xs">
													{t("agentFiles.sizeKb", { size: (file.sizeBytes / BYTES_PER_KB).toFixed(1) })}
												</span>
											</div>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												disabled={deleteFile.isPending}
												onClick={() => {
													if (!agent.contextId) return
													setUploadError(null)
													deleteFile.mutate(
														{ contextId: agent.contextId, name: file.name },
														{
															onError: (error) =>
																setUploadError(error instanceof Error ? error.message : String(error)),
														},
													)
												}}
												aria-label={t("agentFiles.delete", { name: file.name })}
											>
												<Trash2 className="size-4" />
											</Button>
										</li>
									))}
								</ul>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}
