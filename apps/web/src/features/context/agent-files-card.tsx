import type { AgentFile } from "@/api/generated/models/agentFile.zod"

import {
	downloadAgentFile,
	getListAgentFilesQueryKey,
	getListAgentFilesQueryOptions,
	useDeleteAgentFile,
	useListAgentFiles,
	useRenameAgentFile,
	useRetryAgentFile,
	useUploadAgentFile,
} from "@/api/generated/agent/agent.ts"
import { formatBytes, formatFileDate, splitExtension } from "@/features/context/format"
import { getProblemMessage } from "@/lib/problem-message.ts"
import { useLanguage } from "@/lib/use-language"
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@talqo/ui/components/tooltip"
import { useQueryClient } from "@tanstack/react-query"
import {
	CircleAlertIcon,
	CircleCheckIcon,
	ClockIcon,
	Download,
	FileText,
	LoaderCircleIcon,
	Pencil,
	RotateCcw,
	Trash2,
	Upload,
} from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

// eslint-disable-next-line no-magic-numbers
const BYTES_PER_MB = 1024 * 1024
const EMBEDDING_REFRESH_MS = 3_000

// The generated client interpolates path params unencoded; names may legally contain "#", "?", or "%".
function pathName(name: string): string {
	return encodeURIComponent(name)
}

const embeddingStatusMessages = {
	pending: "agentFiles.status.pending",
	processing: "agentFiles.status.processing",
	ready: "agentFiles.status.ready",
	failed: "agentFiles.status.failed",
} as const satisfies Record<AgentFile["embeddingStatus"], string>

const embeddingErrorMessages = {
	"conversion-failed": "agentFiles.error.conversionFailed",
	"empty-document": "agentFiles.error.emptyDocument",
	"provider-error": "agentFiles.error.providerError",
	unknown: "agentFiles.error.unknown",
} as const satisfies Record<NonNullable<AgentFile["embeddingError"]>, string>

type EmbeddingStatusStyle = {
	Icon: typeof ClockIcon
	className: string
	spin?: boolean
}

const embeddingStatusStyles: Record<AgentFile["embeddingStatus"], EmbeddingStatusStyle> = {
	pending: { Icon: ClockIcon, className: "text-muted-foreground" },
	processing: { Icon: LoaderCircleIcon, className: "text-amber-600 dark:text-amber-500", spin: true },
	ready: { Icon: CircleCheckIcon, className: "text-green-600 dark:text-green-500" },
	failed: { Icon: CircleAlertIcon, className: "text-destructive" },
}

function EmbeddingStatusLine({ file, t }: { file: AgentFile; t: (key: string) => string }) {
	const style = embeddingStatusStyles[file.embeddingStatus]
	const { Icon } = style
	return (
		<p role="status" className={`flex items-center gap-1.5 text-xs ${style.className}`}>
			<Icon aria-hidden className={style.spin ? "size-3.5 animate-spin" : "size-3.5"} />
			<span>
				{t(embeddingStatusMessages[file.embeddingStatus])}
				{file.embeddingStatus === "failed" && file.embeddingError
					? ` · ${t(embeddingErrorMessages[file.embeddingError])}`
					: ""}
			</span>
		</p>
	)
}

export function AgentFilesCard({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const queryClient = useQueryClient()

	// List requires agents:manage; read-only members skip the query instead of landing on a 403.
	const filesQuery = useListAgentFiles(agentId, {
		query: {
			...getListAgentFilesQueryOptions(agentId),
			enabled: canManage,
			refetchInterval: (query) =>
				query.state.data?.data.files.some(
					(file) => file.embeddingStatus === "pending" || file.embeddingStatus === "processing",
				)
					? EMBEDDING_REFRESH_MS
					: false,
		},
	})
	const uploadFile = useUploadAgentFile()
	const renameFile = useRenameAgentFile()
	const deleteFile = useDeleteAgentFile()
	const retryFile = useRetryAgentFile()

	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const [dragging, setDragging] = useState(false)
	const [fileError, setFileError] = useState<string | null>(null)
	const [renameTarget, setRenameTarget] = useState<AgentFile | null>(null)
	const [renameValue, setRenameValue] = useState("")
	const [renameError, setRenameError] = useState<string | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<AgentFile | null>(null)
	const [deleteError, setDeleteError] = useState<string | null>(null)
	const [downloadingName, setDownloadingName] = useState<string | null>(null)
	const [retryingName, setRetryingName] = useState<string | null>(null)

	const maxSizeBytes = filesQuery.data?.data.maxSizeBytes
	const maxSizeMB = maxSizeBytes ? Math.round(maxSizeBytes / BYTES_PER_MB) : undefined
	const allowedExtensions = filesQuery.data?.data.allowedExtensions
	const formats = allowedExtensions?.map((extension) => extension.slice(1).toUpperCase()).join(", ")

	function refresh() {
		return queryClient.invalidateQueries({ queryKey: getListAgentFilesQueryKey(agentId) })
	}

	async function startBatch(fileList: FileList | null) {
		if (!fileList?.length) return
		setFileError(null)
		const files = Array.from(fileList)
		if (maxSizeBytes !== undefined && files.some((file) => file.size > maxSizeBytes)) {
			setFileError(t("agentFiles.tooLarge", { maxSizeMB: maxSizeMB ?? 0 }))
			if (fileInputRef.current) fileInputRef.current.value = ""
			return
		}
		try {
			// Sequential so per-file feedback lines up with selection order.
			for (const file of files) {
				// eslint-disable-next-line no-await-in-loop
				await uploadFile.mutateAsync({ agentId, data: { file } })
			}
		} catch (error) {
			setFileError(getProblemMessage(error, t, t("agentFiles.uploadFailed")))
		} finally {
			// Refresh even on failure: earlier files of a batch may have landed before the error.
			await refresh()
			if (fileInputRef.current) fileInputRef.current.value = ""
		}
	}

	function onDrop(event: React.DragEvent<HTMLDivElement>) {
		event.preventDefault()
		setDragging(false)
		void startBatch(event.dataTransfer.files)
	}

	async function onDownload(file: AgentFile) {
		setFileError(null)
		setDownloadingName(file.name)
		try {
			const response = await downloadAgentFile(agentId, pathName(file.name))
			const url = URL.createObjectURL(response.data)
			const anchor = document.createElement("a")
			anchor.href = url
			anchor.download = file.name
			anchor.click()
			URL.revokeObjectURL(url)
		} catch (error) {
			setFileError(getProblemMessage(error, t, t("agentFiles.downloadFailed")))
		} finally {
			setDownloadingName(null)
		}
	}

	function openRename(file: AgentFile) {
		setRenameTarget(file)
		setRenameValue(splitExtension(file.name).base)
		setRenameError(null)
	}

	async function submitRename(event: React.FormEvent) {
		event.preventDefault()
		if (!renameTarget) return
		const trimmed = renameValue.trim()
		if (!trimmed) return
		setRenameError(null)
		try {
			await renameFile.mutateAsync({ agentId, fileName: pathName(renameTarget.name), data: { name: trimmed } })
			setRenameTarget(null)
			await refresh()
		} catch (error) {
			setRenameError(getProblemMessage(error, t, t("agentFiles.renameFailed")))
		}
	}

	function openDelete(file: AgentFile) {
		setDeleteTarget(file)
		setDeleteError(null)
	}

	async function onConfirmDelete() {
		if (!deleteTarget) return
		setDeleteError(null)
		try {
			await deleteFile.mutateAsync({ agentId, fileName: pathName(deleteTarget.name) })
			setDeleteTarget(null)
			await refresh()
		} catch (error) {
			setDeleteError(getProblemMessage(error, t, t("agentFiles.deleteFailed")))
		}
	}

	async function onRetry(file: AgentFile) {
		setFileError(null)
		setRetryingName(file.name)
		try {
			await retryFile.mutateAsync({ agentId, fileName: pathName(file.name) })
			await refresh()
		} catch (error) {
			setFileError(getProblemMessage(error, t, t("agentFiles.retryFailed")))
		} finally {
			setRetryingName(null)
		}
	}

	const files = filesQuery.data?.data.files ?? []

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("agentFiles.cardTitle")}</CardTitle>
				{maxSizeMB !== undefined && formats !== undefined && (
					<CardDescription>{t("agentFiles.cardDescription", { maxSizeMB, formats })}</CardDescription>
				)}
			</CardHeader>
			<CardContent className="space-y-4">
				{canManage && (
					<div
						role="button"
						tabIndex={uploadFile.isPending ? -1 : 0}
						aria-disabled={uploadFile.isPending}
						className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors ${
							dragging ? "border-primary bg-accent" : "border-input hover:border-ring hover:bg-accent/50"
						} ${uploadFile.isPending ? "pointer-events-none opacity-60" : ""}`}
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
							id="agent-file-input"
							type="file"
							accept={allowedExtensions?.join(",")}
							multiple
							className="sr-only"
							disabled={uploadFile.isPending}
							onChange={(event) => void startBatch(event.target.files)}
						/>
						{uploadFile.isPending ? (
							<LoaderCircleIcon aria-hidden className="text-primary size-6 animate-spin" />
						) : (
							<Upload className="text-muted-foreground size-6" />
						)}
						<p className="text-sm font-medium">
							{uploadFile.isPending ? t("agentFiles.uploading") : t("agentFiles.dropzone")}
						</p>
						{files.length === 0 && !filesQuery.isLoading && !filesQuery.isError && (
							<p className="text-muted-foreground text-xs">{t("agentFiles.dropzoneHint")}</p>
						)}
					</div>
				)}
				{fileError && (
					<p role="alert" className="text-destructive text-xs">
						{fileError}
					</p>
				)}
				{filesQuery.isLoading ? (
					<p className="text-muted-foreground text-sm">{t("agentFiles.loading")}</p>
				) : filesQuery.isError ? (
					<p className="text-destructive text-sm">{t("agentFiles.loadFailed")}</p>
				) : !canManage || files.length === 0 ? null : (
					<ul className="divide-border divide-y rounded-md border">
						{files.map((file) => (
							<li key={file.name} className="flex items-center gap-3 px-3 py-2">
								<FileText className="text-muted-foreground size-4 shrink-0" />
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm">{file.name}</p>
									<p className="text-muted-foreground text-xs">
										{formatBytes(file.sizeBytes)} · {formatFileDate(file.createdAt, language)}
									</p>
									<EmbeddingStatusLine file={file} t={t} />
								</div>
								{canManage && (
									<TooltipProvider>
										{file.embeddingStatus === "failed" && (
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={retryingName === file.name}
												onClick={() => void onRetry(file)}
												aria-label={t("agentFiles.retry", { name: file.name })}
											>
												{retryingName === file.name ? (
													<LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
												) : (
													<RotateCcw className="size-4" />
												)}
												{t("agentFiles.retryAction")}
											</Button>
										)}
										<Tooltip>
											<TooltipTrigger
												render={
													<Button
														type="button"
														variant="ghost"
														size="icon"
														disabled={downloadingName === file.name}
														onClick={() => void onDownload(file)}
														aria-label={t("agentFiles.download", { name: file.name })}
													/>
												}
											>
												<Download className="size-4" />
											</TooltipTrigger>
											<TooltipContent>{t("agentFiles.downloadAction")}</TooltipContent>
										</Tooltip>
										<Tooltip>
											<TooltipTrigger
												render={
													<Button
														type="button"
														variant="ghost"
														size="icon"
														onClick={() => openRename(file)}
														aria-label={t("agentFiles.rename", { name: file.name })}
													/>
												}
											>
												<Pencil className="size-4" />
											</TooltipTrigger>
											<TooltipContent>{t("agentFiles.renameAction")}</TooltipContent>
										</Tooltip>
										<Tooltip>
											<TooltipTrigger
												render={
													<Button
														type="button"
														variant="ghost"
														size="icon"
														disabled={deleteFile.isPending}
														onClick={() => openDelete(file)}
														aria-label={t("agentFiles.delete", { name: file.name })}
													/>
												}
											>
												<Trash2 className="size-4" />
											</TooltipTrigger>
											<TooltipContent>{t("agentFiles.deleteAction")}</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								)}
							</li>
						))}
					</ul>
				)}
			</CardContent>

			<Dialog
				open={renameTarget !== null}
				onOpenChange={(open) => {
					if (!open) setRenameTarget(null)
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("agentFiles.renameTitle")}</DialogTitle>
						<DialogDescription>{t("agentFiles.renameDescription")}</DialogDescription>
					</DialogHeader>
					<p className="truncate text-sm font-medium" title={renameTarget?.name}>
						{renameTarget?.name}
					</p>
					<form onSubmit={(event) => void submitRename(event)} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="rename-file-name">{t("agentFiles.renameLabel")}</Label>
							<Input
								id="rename-file-name"
								value={renameValue}
								onChange={(event) => setRenameValue(event.target.value)}
							/>
							{renameTarget && splitExtension(renameTarget.name).extension && (
								<p className="text-muted-foreground text-xs">
									{t("agentFiles.renameExtensionKept", { extension: splitExtension(renameTarget.name).extension })}
								</p>
							)}
						</div>
						{renameError && (
							<p role="alert" className="text-destructive text-xs">
								{renameError}
							</p>
						)}
						<DialogFooter>
							<Button type="submit" disabled={renameFile.isPending || !renameValue.trim()}>
								{t("agentFiles.renameSave")}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog
				open={deleteTarget !== null}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null)
				}}
			>
				<DialogContent className="gap-4">
					<DialogHeader>
						<DialogTitle>{t("agentFiles.deleteTitle")}</DialogTitle>
						<DialogDescription>{t("agentFiles.deletePrompt")}</DialogDescription>
					</DialogHeader>
					{deleteError && (
						<p role="alert" className="text-destructive text-xs">
							{deleteError}
						</p>
					)}
					<div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
						<p className="mr-auto min-w-0 truncate text-sm font-medium" title={deleteTarget?.name}>
							{deleteTarget?.name}
						</p>
						<div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:justify-end">
							<Button variant="outline" onClick={() => setDeleteTarget(null)}>
								{t("agentFiles.deleteCancel")}
							</Button>
							<Button variant="destructive" disabled={deleteFile.isPending} onClick={() => void onConfirmDelete()}>
								{deleteFile.isPending ? t("agentFiles.deleting") : t("agentFiles.deleteConfirm")}
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</Card>
	)
}
