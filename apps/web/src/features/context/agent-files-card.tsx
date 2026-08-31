import type { AgentFile } from "@/api/generated/models/agent/agentFile.zod"

import {
	getListAgentFilesQueryKey,
	getListAgentFilesQueryOptions,
	useDeleteAgentFile,
	useListAgentFiles,
	useRenameAgentFile,
	useUploadAgentFile,
} from "@/api/generated/agent/agent.ts"
import { formatBytes, formatFileDate, splitExtension } from "@/features/context/format"
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
import { FileText, Pencil, Trash2, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

// eslint-disable-next-line no-magic-numbers
const BYTES_PER_MB = 1024 * 1024

function errorMessage(error: unknown, fallback: string): string {
	const info = (error as { info?: { error?: string } }).info
	return info?.error ?? fallback
}

export function AgentFilesCard({ agentId, canManage }: { agentId: string; canManage: boolean }) {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const queryClient = useQueryClient()

	// List requires agents:manage; read-only members skip the query instead of landing on a 403.
	const filesQuery = useListAgentFiles(agentId, {
		query: { ...getListAgentFilesQueryOptions(agentId), enabled: canManage },
	})
	const uploadFile = useUploadAgentFile()
	const renameFile = useRenameAgentFile()
	const deleteFile = useDeleteAgentFile()

	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const [dragging, setDragging] = useState(false)
	const [fileError, setFileError] = useState<string | null>(null)
	const [renameTarget, setRenameTarget] = useState<AgentFile | null>(null)
	const [renameValue, setRenameValue] = useState("")
	const [renameError, setRenameError] = useState<string | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<AgentFile | null>(null)
	const [deleteError, setDeleteError] = useState<string | null>(null)

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
			return
		}
		try {
			// Sequential so per-file feedback lines up with selection order.
			for (const file of files) {
				// eslint-disable-next-line no-await-in-loop
				await uploadFile.mutateAsync({ agentId, data: { file } })
			}
		} catch (error) {
			setFileError(errorMessage(error, t("agentFiles.uploadFailed")))
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
			await renameFile.mutateAsync({ agentId, fileName: renameTarget.name, data: { name: trimmed } })
			setRenameTarget(null)
			await refresh()
		} catch (error) {
			setRenameError(errorMessage(error, t("agentFiles.renameFailed")))
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
			await deleteFile.mutateAsync({ agentId, fileName: deleteTarget.name })
			setDeleteTarget(null)
			await refresh()
		} catch (error) {
			setDeleteError(errorMessage(error, t("agentFiles.deleteFailed")))
		}
	}

	const files = filesQuery.data?.data.files ?? []

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("agentFiles.cardTitle")}</CardTitle>
				<CardDescription>
					{t("agentFiles.cardDescription", { maxSizeMB: maxSizeMB ?? "…", formats: formats ?? "…" })}
				</CardDescription>
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
						<Upload className="text-muted-foreground size-6" />
						<p className="text-sm font-medium">
							{uploadFile.isPending ? t("agentFiles.uploading") : t("agentFiles.dropzone")}
						</p>
						<p className="text-muted-foreground text-xs">{t("agentFiles.dropzoneHint")}</p>
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
								</div>
								{canManage && (
									<TooltipProvider>
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
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("agentFiles.deleteTitle")}</DialogTitle>
						<DialogDescription>{t("agentFiles.deletePrompt")}</DialogDescription>
					</DialogHeader>
					<p className="truncate text-sm font-medium" title={deleteTarget?.name}>
						{deleteTarget?.name}
					</p>
					{deleteError && (
						<p role="alert" className="text-destructive text-xs">
							{deleteError}
						</p>
					)}
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteTarget(null)}>
							{t("agentFiles.deleteCancel")}
						</Button>
						<Button variant="destructive" disabled={deleteFile.isPending} onClick={() => void onConfirmDelete()}>
							{deleteFile.isPending ? t("agentFiles.deleting") : t("agentFiles.deleteConfirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	)
}
