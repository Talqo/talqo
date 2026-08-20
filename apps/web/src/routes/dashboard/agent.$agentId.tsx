import { PageHeader } from "@/components/page-header"
import { agentFormSchema, type AgentFormValues } from "@/features/agents/agent-schema"
import {
	useAgent,
	useAgentFiles,
	useDeleteAgentFile,
	useRenameAgentFile,
	useUpdateAgent,
	useUploadAgentFile,
} from "@/features/agents/agents-query"
import { parseBlacklist } from "@/features/agents/blacklist"
import { zodResolver } from "@hookform/resolvers/zod"
import { Badge } from "@talqo/ui/components/badge"
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
import { Switch } from "@talqo/ui/components/switch"
import { Textarea } from "@talqo/ui/components/textarea"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft, Pencil, Trash2, Upload } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

const BYTES_PER_KB = 1024
// eslint-disable-next-line no-magic-numbers
const BYTES_PER_MB = 1024 * BYTES_PER_KB

function formatSize(sizeBytes: number): string {
	if (sizeBytes < BYTES_PER_MB) return `${Math.max(1, Math.round(sizeBytes / BYTES_PER_KB))} KB`
	return `${(sizeBytes / BYTES_PER_MB).toFixed(1)} MB`
}

export const Route = createFileRoute("/dashboard/agent/$agentId")({
	component: AgentConfigPage,
})

function ContextFilesCard({ agentId }: { agentId: string }) {
	const { t } = useTranslation()
	const { data: filesData, isLoading } = useAgentFiles(agentId)
	const files = filesData?.files
	const maxSizeMB = filesData ? filesData.maxSizeBytes / BYTES_PER_MB : undefined
	const maxNameLength = filesData?.maxNameLength
	const uploadFile = useUploadAgentFile()
	const renameFile = useRenameAgentFile()
	const deleteFile = useDeleteAgentFile()
	const fileInput = useRef<HTMLInputElement>(null)
	const [pendingDelete, setPendingDelete] = useState<string | null>(null)
	const [pendingRename, setPendingRename] = useState<string | null>(null)
	const [renameValue, setRenameValue] = useState("")
	const [dragging, setDragging] = useState(false)

	function openRename(name: string) {
		setPendingRename(name)
		setRenameValue(name)
	}

	function uploadFiles(dropped: Iterable<File>) {
		for (const file of dropped) uploadFile.mutate({ agentId, file })
	}

	function onFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
		if (event.target.files) uploadFiles(event.target.files)
		event.target.value = ""
	}

	function onDrop(event: React.DragEvent<HTMLDivElement>) {
		event.preventDefault()
		setDragging(false)
		if (!uploadFile.isPending) uploadFiles(event.dataTransfer.files)
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("agentConfig.files.title")}</CardTitle>
				<CardDescription>{t("agentConfig.files.description")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<input
					ref={fileInput}
					type="file"
					accept=".pdf,.txt,.md,.docx"
					multiple
					className="hidden"
					onChange={onFilePicked}
				/>
				<div
					role="button"
					tabIndex={0}
					aria-label={t("agentConfig.files.upload")}
					aria-disabled={uploadFile.isPending}
					className={`flex flex-col items-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors ${
						dragging ? "border-primary bg-primary/5" : "border-border"
					} ${uploadFile.isPending ? "cursor-not-allowed opacity-60" : "hover:border-primary/50 cursor-pointer"}`}
					onClick={() => !uploadFile.isPending && fileInput.current?.click()}
					onKeyDown={(event) => {
						if (!uploadFile.isPending && (event.key === "Enter" || event.key === " ")) fileInput.current?.click()
					}}
					onDragOver={(event) => {
						event.preventDefault()
						if (!uploadFile.isPending) setDragging(true)
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={onDrop}
				>
					<Upload className="text-muted-foreground size-6" />
					<p className="text-sm font-medium">
						{uploadFile.isPending ? t("agentConfig.files.uploading") : t("agentConfig.files.dropzone")}
					</p>
					<p className="text-muted-foreground text-xs">
						{maxSizeMB !== undefined && t("agentConfig.files.acceptedTypes", { maxSize: maxSizeMB })}
					</p>
				</div>
				{uploadFile.isError && (
					<p className="text-destructive text-xs">
						{t("agentConfig.files.uploadError", { message: uploadFile.error.message })}
					</p>
				)}
				{isLoading ? (
					<p className="text-muted-foreground text-sm">{t("agentConfig.files.loading")}</p>
				) : !files?.length ? (
					<p className="text-muted-foreground text-sm">{t("agentConfig.files.empty")}</p>
				) : (
					<ul className="divide-y overflow-hidden rounded-md border">
						{files.map((file) => (
							<li key={file.name} className="flex items-center justify-between gap-3 px-3 py-2">
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium" title={file.name}>
										{file.name}
									</p>
									<p className="text-muted-foreground text-xs whitespace-nowrap">
										{formatSize(file.sizeBytes)} · {new Date(file.createdAt).toLocaleDateString()}
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<Button
										variant="ghost"
										size="icon"
										aria-label={t("agentConfig.files.rename")}
										onClick={() => openRename(file.name)}
									>
										<Pencil className="size-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label={t("agentConfig.files.delete")}
										onClick={() => setPendingDelete(file.name)}
									>
										<Trash2 className="text-destructive size-4" />
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</CardContent>

			<Dialog open={pendingRename !== null} onOpenChange={(open) => !open && setPendingRename(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("agentConfig.files.rename")}</DialogTitle>
						<DialogDescription>{t("agentConfig.files.renameDescription")}</DialogDescription>
					</DialogHeader>
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault()
							if (!pendingRename || !renameValue.trim()) return
							renameFile.mutate(
								{ agentId, name: pendingRename, newName: renameValue.trim() },
								{ onSuccess: () => setPendingRename(null) },
							)
						}}
					>
						<div className="space-y-2">
							<Label htmlFor="rename-file">{t("agentConfig.files.renameLabel", { maxLength: maxNameLength })}</Label>
							<Input
								id="rename-file"
								value={renameValue}
								onChange={(event) => setRenameValue(event.target.value)}
								maxLength={maxNameLength}
								aria-invalid={renameValue.trim() ? undefined : true}
							/>
							<p className="text-muted-foreground text-xs">{t("agentConfig.files.renameExtensionNote")}</p>
							{renameFile.isError && <p className="text-destructive text-xs">{renameFile.error.message}</p>}
						</div>
						<DialogFooter>
							<Button type="submit" disabled={renameFile.isPending || !renameValue.trim()}>
								{t("agentConfig.files.renameSave")}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("agentConfig.files.delete")}</DialogTitle>
						{/* pr-8 keeps long names clear of the absolute-positioned close button. */}
						<DialogDescription className="pr-8">
							{t("agentConfig.files.deleteConfirm", { name: pendingDelete ?? "" })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="destructive"
							disabled={deleteFile.isPending}
							onClick={() =>
								pendingDelete &&
								deleteFile.mutate({ agentId, name: pendingDelete }, { onSuccess: () => setPendingDelete(null) })
							}
						>
							{t("agentConfig.files.delete")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	)
}

function AgentConfigPage() {
	const { t } = useTranslation()
	const { agentId } = Route.useParams()
	const { data: agent, isLoading } = useAgent(agentId)
	const updateAgent = useUpdateAgent()

	const [saved, setSaved] = useState(false)

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
		updateAgent.mutate(
			{
				id: agentId,
				patch: {
					name: values.name.trim(),
					systemPrompt: values.systemPrompt.trim(),
					wordBlacklist: parseBlacklist(values.wordBlacklist),
					status: values.active ? "active" : "paused",
				},
			},
			{ onSuccess: () => setSaved(true) },
		)
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
					<ContextFilesCard agentId={agentId} />
				</>
			)}
		</div>
	)
}
