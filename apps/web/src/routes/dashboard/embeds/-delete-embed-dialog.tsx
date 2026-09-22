import {
	type DeleteEmbedMutationError,
	getGetEmbedQueryKey,
	getListEmbedsQueryKey,
	useDeleteEmbed,
} from "@/api/generated/embed/embed.ts"
import { Button } from "@talqo/ui/components/button"
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
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

const NOT_FOUND_STATUS = 404

type DeleteTarget = { agentId: string; id: string; name: string }

export function DeleteEmbedDialog({ embed }: { embed: DeleteTarget }) {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const deleteEmbed = useDeleteEmbed()
	const [open, setOpen] = useState(false)
	const [confirmation, setConfirmation] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [isDeleting, setIsDeleting] = useState(false)

	async function onConfirm() {
		setError(null)
		setIsDeleting(true)
		try {
			await deleteEmbed.mutateAsync({ embedId: embed.id })
			queryClient.removeQueries({ queryKey: getListEmbedsQueryKey() })
			await navigate({
				to: "/dashboard/agent/$agentId",
				params: { agentId: embed.agentId },
				search: { tab: "embeds" },
				replace: true,
			})
			queryClient.removeQueries({ queryKey: getGetEmbedQueryKey(embed.id) })
		} catch (caught) {
			setError(
				(caught as DeleteEmbedMutationError).status === NOT_FOUND_STATUS
					? t("embedSetup.notFound")
					: t("embedSetup.deleteFailed"),
			)
			setIsDeleting(false)
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (isDeleting) return
				setOpen(nextOpen)
				if (!nextOpen) {
					setConfirmation("")
					setError(null)
				}
			}}
		>
			<Button variant="destructive" onClick={() => setOpen(true)}>
				<Trash2 className="size-4" />
				{t("embedSetup.deleteEmbed")}
			</Button>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("embedSetup.deleteTitle")}</DialogTitle>
					<DialogDescription>{t("embedSetup.deletePrompt", { name: embed.name })}</DialogDescription>
				</DialogHeader>
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				<div className="space-y-2">
					<Label htmlFor="delete-embed-confirmation" className="flex items-center gap-2">
						<span className="sr-only">{t("embedSetup.confirmLabel", { name: embed.name })}</span>
					</Label>
					<Input
						id="delete-embed-confirmation"
						value={confirmation}
						onChange={(event) => setConfirmation(event.target.value)}
						placeholder={embed.name}
						autoComplete="off"
					/>
					<p className="text-muted-foreground text-xs">{t("embedSetup.confirmHelp", { name: embed.name })}</p>
				</div>
				<DialogFooter>
					<Button variant="outline" disabled={isDeleting} onClick={() => setOpen(false)}>
						{t("embedSetup.cancel")}
					</Button>
					<Button variant="destructive" disabled={confirmation !== embed.name || isDeleting} onClick={onConfirm}>
						{isDeleting ? t("embedSetup.deleting") : t("embedSetup.deleteConfirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
