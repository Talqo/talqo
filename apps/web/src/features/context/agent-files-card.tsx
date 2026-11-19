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
import { ProblemAlert } from "@/components/problem-alert"
import { formatBytes, splitExtension } from "@/features/context/format"
import { hasActiveIngestion, INGESTION_REFRESH_MS, IngestionStatusLine } from "@/features/context/ingestion-status"
import { formatDateTime } from "@/lib/format-date"
import { getProblemMessage } from "@/lib/problem-message.ts"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@talqo/ui/components/dialog"
import { EmptyState } from "@talqo/ui/components/empty-state"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@talqo/ui/components/tooltip"
import { useQueryClient } from "@tanstack/react-query"
import {
	Download,
	FileText,
	LoaderCircleIcon,
	Pencil,
	RotateCcw,
	Trash2,
	Upload,
} from "lucide-react"
import { type RefObject, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

// eslint-disable-next-line no-magic-numbers
const BYTES_PER_MB = 1024 * 1024

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

function fileErrorLabel(file: AgentFile, t: (key: string) => string): string | undefined {
	return file.embeddingStatus === "failed" && file.embeddingError
		? t(embeddingErrorMessages[file.embeddingError])
		: undefined
}

function useAgentFilesQuery(agentId: string) {
	const queryClient = useQueryClient()
	const filesQuery = useListAgentFiles(agentId, {
		query: {
			...getListAgentFilesQueryOptions(agentId),
			refetchInterval: (query) => (hasActiveIngestion(query.state.data?.data.files) ? INGESTION_REFRESH_MS : false),
		},
	})
	function refresh() {
		return queryClient.invalidateQueries({ queryKey: getListAgentFilesQueryKey(agentId) })
	}
	return { filesQuery, refresh }
}

type UploadProps = {
	agentId: string
	refresh: () => Promise<unknown>
	maxSizeBytes: number | undefined
	maxSizeMB: number | undefined
}

function useAgentFileUpload(props: UploadProps) {
	const { t } = useTranslation()
	const uploadFile = useUploadAgentFile()
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const [dragging, setDragging] = useState(false)
	const [fileError, setFileError] = useState<string | null>(null)

	async function startBatch(fileList: FileList | null) {
		if (!fileList?.length) return
		setFileError(null)
		const files = Array.from(fileList)
		const maxSizeBytes = props.maxSizeBytes
		if (maxSizeBytes !== undefined && files.some((file) => file.size > maxSizeBytes)) {
			setFileError(t("agentFiles.tooLarge", { maxSizeMB: props.maxSizeMB ?? 0 }))
			if (fileInputRef.current) fileInputRef.current.value = ""
			return
		}
		try {
			// Sequential so per-file feedback lines up with selection order.
			for (const file of files) {
				await uploadFile.mutateAsync({ agentId: props.agentId, data: { file } })
			}
		} catch (error) {
			setFileError(getProblemMessage(error, t, t("agentFiles.uploadFailed")))
		} finally {
			// Refresh even on failure: earlier files of a batch may have landed before the error.
			await props.refresh()
			if (fileInputRef.current) fileInputRef.current.value = ""
		}
	}

	function onDrop(event: React.DragEvent<HTMLButtonElement>) {
		event.preventDefault()
		setDragging(false)
		void startBatch(event.dataTransfer.files)
	}

	return {
		fileInputRef,
		dragging,
		setDragging,
		fileError,
		setFileError,
		startBatch,
		onDrop,
		uploading: uploadFile.isPending,
	}
}

function useAgentFileDownload(agentId: string, setFileError: (message: string | null) => void) {
	const { t } = useTranslation()
	const [downloadingName, setDownloadingName] = useState<string | null>(null)

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

	return { downloadingName, onDownload }
}

function useAgentFileRetry(
	agentId: string,
	refresh: () => Promise<unknown>,
	setFileError: (message: string | null) => void,
) {
	const { t } = useTranslation()
	const retryFile = useRetryAgentFile()
	const [retryingName, setRetryingName] = useState<string | null>(null)

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

	return { retryingName, onRetry }
}

function useAgentFileRename(agentId: string, refresh: () => Promise<unknown>) {
	const { t } = useTranslation()
	const renameFile = useRenameAgentFile()
	const [renameTarget, setRenameTarget] = useState<AgentFile | null>(null)
	const [renameValue, setRenameValue] = useState("")
	const [renameError, setRenameError] = useState<string | null>(null)

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

	function close() {
		setRenameTarget(null)
		setRenameError(null)
	}

	return {
		renameTarget,
		renameValue,
		setRenameValue,
		renameError,
		openRename,
		submitRename,
		filePending: renameFile.isPending,
		close,
	}
}

function useAgentFileDelete(agentId: string, refresh: () => Promise<unknown>) {
	const { t } = useTranslation()
	const deleteFile = useDeleteAgentFile()
	const [deleteTarget, setDeleteTarget] = useState<AgentFile | null>(null)
	const [deleteError, setDeleteError] = useState<string | null>(null)

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

	function close() {
		setDeleteTarget(null)
		setDeleteError(null)
		deleteFile.reset()
	}

	return { deleteTarget, deleteError, deleteFile, openDelete, onConfirmDelete, close }
}

function AgentFilesDropzone({
	fileInputRef,
	uploading,
	dragging,
	onDragChange,
	onDrop,
	onSelect,
	allowedExtensions,
	showHint,
}: {
	fileInputRef: RefObject<HTMLInputElement | null>
	uploading: boolean
	dragging: boolean
	onDragChange: (dragging: boolean) => void
	onDrop: (event: React.DragEvent<HTMLButtonElement>) => void
	onSelect: (files: FileList | null) => void
	allowedExtensions: string[] | undefined
	showHint: boolean
}) {
	const { t } = useTranslation()
	return (
		<>
			<input
				ref={fileInputRef}
				id="agent-file-input"
				type="file"
				accept={allowedExtensions?.join(",")}
				multiple
				hidden
				disabled={uploading}
				onChange={(event) => onSelect(event.target.files)}
			/>
			<button
				type="button"
				disabled={uploading}
				className={`flex min-h-24 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors ${
					dragging ? "border-primary bg-accent" : "border-input hover:border-ring hover:bg-accent/50"
				} ${uploading ? "pointer-events-none opacity-60" : ""}`}
				onClick={() => fileInputRef.current?.click()}
				onDragOver={(event) => {
					event.preventDefault()
					onDragChange(true)
				}}
				onDragLeave={() => onDragChange(false)}
				onDrop={onDrop}
			>
				{uploading ? (
					<LoaderCircleIcon aria-hidden className="text-primary size-6 animate-spin" />
				) : (
					<Upload className="text-muted-foreground size-6" />
				)}
				<span className="text-sm font-medium">{uploading ? t("agentFiles.uploading") : t("agentFiles.dropzone")}</span>
				{showHint && <span className="text-muted-foreground text-xs">{t("agentFiles.dropzoneHint")}</span>}
			</button>
		</>
	)
}

function AgentFilesLoading() {
	const { t } = useTranslation()
	return (
		<div className="divide-border divide-y rounded-md border">
			<output className="sr-only">{t("agentFiles.loading")}</output>
			{Array.from({ length: 3 }, (_, index) => (
				<div key={index} className="flex items-center gap-3 px-3 py-2">
					<Skeleton className="size-4 shrink-0" />
					<div className="min-w-0 flex-1 space-y-2">
						<Skeleton className="h-4 w-2/3 max-w-full" />
						<Skeleton className="h-3 w-1/2 max-w-full" />
					</div>
				</div>
			))}
		</div>
	)
}

function FileRowActions(props: {
	file: AgentFile
	canManage: boolean
	retrying: boolean
	downloading: boolean
	onRetry: (file: AgentFile) => void
	onDownload: (file: AgentFile) => void
	onRename: (file: AgentFile) => void
	onDelete: (file: AgentFile) => void
}) {
	const { t } = useTranslation()
	return (
		<TooltipProvider>
			{props.canManage && props.file.embeddingStatus === "failed" && (
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={props.retrying}
					onClick={() => props.onRetry(props.file)}
					aria-label={t("agentFiles.retry", { name: props.file.name })}
				>
					{props.retrying ? (
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
							disabled={props.downloading}
							onClick={() => props.onDownload(props.file)}
							aria-label={t("agentFiles.download", { name: props.file.name })}
						/>
					}
				>
					<Download className="size-4" />
				</TooltipTrigger>
				<TooltipContent>{t("agentFiles.downloadAction")}</TooltipContent>
			</Tooltip>
			{props.canManage && (
				<>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => props.onRename(props.file)}
									aria-label={t("agentFiles.rename", { name: props.file.name })}
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
									variant="destructive"
									size="icon"
									onClick={() => props.onDelete(props.file)}
									aria-label={t("agentFiles.delete", { name: props.file.name })}
								/>
							}
						>
							<Trash2 className="size-4" />
						</TooltipTrigger>
						<TooltipContent>{t("agentFiles.deleteAction")}</TooltipContent>
					</Tooltip>
				</>
			)}
		</TooltipProvider>
	)
}

function AgentFileRow(props: {
	file: AgentFile
	canManage: boolean
	retrying: boolean
	downloading: boolean
	onRetry: (file: AgentFile) => void
	onDownload: (file: AgentFile) => void
	onRename: (file: AgentFile) => void
	onDelete: (file: AgentFile) => void
}) {
	const { t } = useTranslation()
	const { language } = useLanguage()
	return (
		<li className="flex items-center gap-3 px-3 py-2">
			<FileText className="text-muted-foreground size-4 shrink-0" />
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm">{props.file.name}</p>
				<p className="text-muted-foreground text-xs">
					{formatBytes(props.file.sizeBytes)} · {formatDateTime(props.file.createdAt, language)}
				</p>
				<IngestionStatusLine
					status={props.file.embeddingStatus}
					label={t(embeddingStatusMessages[props.file.embeddingStatus])}
					errorLabel={fileErrorLabel(props.file, t)}
				/>
			</div>
			<FileRowActions
				file={props.file}
				canManage={props.canManage}
				retrying={props.retrying}
				downloading={props.downloading}
				onRetry={props.onRetry}
				onDownload={props.onDownload}
				onRename={props.onRename}
				onDelete={props.onDelete}
			/>
		</li>
	)
}

type FilesListProps = {
	files: AgentFile[]
	canManage: boolean
	retryingName: string | null
	downloadingName: string | null
	onRetry: (file: AgentFile) => void
	onDownload: (file: AgentFile) => void
	onRename: (file: AgentFile) => void
	onDelete: (file: AgentFile) => void
}

function AgentFilesList(props: FilesListProps) {
	return (
		<ul className="divide-border divide-y rounded-md border">
			{props.files.map((file) => (
				<AgentFileRow
					key={file.name}
					file={file}
					canManage={props.canManage}
					retrying={props.retryingName === file.name}
					downloading={props.downloadingName === file.name}
					onRetry={props.onRetry}
					onDownload={props.onDownload}
					onRename={props.onRename}
					onDelete={props.onDelete}
				/>
			))}
		</ul>
	)
}

function AgentFilesContent(
	props: FilesListProps & {
		isLoading: boolean
		isError: boolean
		error: unknown
		refetch: () => Promise<unknown>
	},
) {
	const { t } = useTranslation()
	if (props.isLoading) return <AgentFilesLoading />
	if (props.isError) return <ProblemAlert error={props.error} onRetry={() => void props.refetch()} />
	if (!props.files.length) {
		// The dropzone already invites managers to upload; readers need to know the list is empty.
		if (props.canManage) return null
		return (
			<EmptyState
				icon={FileText}
				title={t("agentFiles.emptyTitle")}
				description={t("agentFiles.emptyDescriptionReader")}
			/>
		)
	}
	return <AgentFilesList {...props} />
}

function RenameFileDialog({ rename }: { rename: ReturnType<typeof useAgentFileRename> }) {
	const { t } = useTranslation()
	const target = rename.renameTarget
	return (
		<Dialog
			open={target !== null}
			onOpenChange={(open) => {
				if (!open && !rename.filePending) rename.close()
			}}
		>
			<DialogContent closeLabel={t("common.close")}>
				<DialogHeader>
					<DialogTitle>{t("agentFiles.renameTitle")}</DialogTitle>
					<DialogDescription>{t("agentFiles.renameDescription")}</DialogDescription>
				</DialogHeader>
				<p className="truncate text-sm font-medium" title={target?.name}>
					{target?.name}
				</p>
				<form onSubmit={(event) => void rename.submitRename(event)} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="rename-file-name">{t("agentFiles.renameLabel")}</Label>
						<Input
							id="rename-file-name"
							value={rename.renameValue}
							onChange={(event) => rename.setRenameValue(event.target.value)}
						/>
						{target && splitExtension(target.name).extension && (
							<p className="text-muted-foreground text-xs">
								{t("agentFiles.renameExtensionKept", { extension: splitExtension(target.name).extension })}
							</p>
						)}
					</div>
					{rename.renameError && (
						<p role="alert" className="text-destructive text-xs">
							{rename.renameError}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="outline" disabled={rename.filePending} onClick={rename.close}>
							{t("common.cancel")}
						</Button>
						<Button type="submit" disabled={rename.filePending || !rename.renameValue.trim()}>
							{rename.filePending ? t("agentFiles.renaming") : t("agentFiles.renameSave")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

function DeleteFileDialog({ deletion }: { deletion: ReturnType<typeof useAgentFileDelete> }) {
	const { t } = useTranslation()
	return (
		<ConfirmDialog
			open={deletion.deleteTarget !== null}
			onOpenChange={(open) => {
				if (!open) deletion.close()
			}}
			title={t("agentFiles.deleteTitle")}
			description={t("agentFiles.deletePrompt")}
			cancelLabel={t("common.cancel")}
			confirmLabel={t("agentFiles.deleteConfirm")}
			pendingLabel={t("agentFiles.deleting")}
			pending={deletion.deleteFile.isPending}
			error={deletion.deleteError ?? undefined}
			onConfirm={() => void deletion.onConfirmDelete()}
		>
			<p className="truncate text-sm font-medium" title={deletion.deleteTarget?.name}>
				{deletion.deleteTarget?.name}
			</p>
		</ConfirmDialog>
	)
}

export function AgentFilesCard({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const { filesQuery, refresh } = useAgentFilesQuery(agentId)
	const files = filesQuery.data?.data.files ?? []
	const maxSizeBytes = filesQuery.data?.data.maxSizeBytes
	const maxSizeMB = maxSizeBytes ? Math.round(maxSizeBytes / BYTES_PER_MB) : undefined
	const allowedExtensions = filesQuery.data?.data.allowedExtensions
	const formats = allowedExtensions?.map((extension) => extension.slice(1).toUpperCase()).join(", ")
	const upload = useAgentFileUpload({ agentId, refresh, maxSizeBytes, maxSizeMB })
	const download = useAgentFileDownload(agentId, upload.setFileError)
	const retry = useAgentFileRetry(agentId, refresh, upload.setFileError)
	const rename = useAgentFileRename(agentId, refresh)
	const deletion = useAgentFileDelete(agentId, refresh)

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("agentFiles.cardTitle")}</CardTitle>
				{maxSizeMB !== undefined && formats !== undefined && (
					<CardDescription>{t("agentFiles.cardDescription", { maxSizeMB, formats })}</CardDescription>
				)}
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{canManage && (
						<AgentFilesDropzone
							fileInputRef={upload.fileInputRef}
							uploading={upload.uploading}
							dragging={upload.dragging}
							onDragChange={upload.setDragging}
							onDrop={upload.onDrop}
							onSelect={(selected) => void upload.startBatch(selected)}
							allowedExtensions={allowedExtensions}
							showHint={files.length === 0 && !filesQuery.isLoading && !filesQuery.isError}
						/>
					)}
					{upload.fileError && (
						<p role="alert" className="text-destructive text-xs">
							{upload.fileError}
						</p>
					)}
					<AgentFilesContent
						files={files}
						canManage={canManage}
						retryingName={retry.retryingName}
						downloadingName={download.downloadingName}
						onRetry={(file) => void retry.onRetry(file)}
						onDownload={(file) => void download.onDownload(file)}
						onRename={rename.openRename}
						onDelete={deletion.openDelete}
						isLoading={filesQuery.isLoading}
						isError={filesQuery.isError}
						error={filesQuery.error}
						refetch={filesQuery.refetch}
					/>
				</div>
			</CardContent>
			<RenameFileDialog rename={rename} />
			<DeleteFileDialog deletion={deletion} />
		</Card>
	)
}
