import { getGetEmbedQueryKey, getListEmbedsQueryKey, useDeleteEmbed } from "@/api/generated/embed/embed.ts"
import { getProblemMessage } from "@/lib/problem-message"
import { Button } from "@talqo/ui/components/button"
import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

type DeleteTarget = { agentId: string; id: string; name: string }

export function DeleteEmbedDialog({ embed }: { embed: DeleteTarget }) {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const deleteEmbed = useDeleteEmbed()
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function onConfirm() {
		setError(null)
		try {
			await deleteEmbed.mutateAsync({ embedId: embed.id })
			queryClient.removeQueries({ queryKey: getListEmbedsQueryKey() })
			await navigate({
				to: "/dashboard/agent/$agentId",
				params: { agentId: embed.agentId },
				search: { tab: "embeds" },
				replace: true,
				ignoreBlocker: true,
			})
			queryClient.removeQueries({ queryKey: getGetEmbedQueryKey(embed.id) })
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("embedSetup.deleteFailed")))
		}
	}

	return (
		<>
			<Button
				variant="destructive"
				onClick={() => {
					setError(null)
					deleteEmbed.reset()
					setOpen(true)
				}}
			>
				<Trash2 className="size-4" />
				{t("embedSetup.deleteEmbed")}
			</Button>
			<ConfirmDialog
				open={open}
				onOpenChange={(next) => {
					setOpen(next)
					if (!next) {
						setError(null)
						deleteEmbed.reset()
					}
				}}
				title={t("embedSetup.deleteTitle")}
				description={t("embedSetup.deletePrompt", { name: embed.name })}
				cancelLabel={t("embedSetup.cancel")}
				confirmLabel={t("embedSetup.deleteConfirm")}
				pendingLabel={t("embedSetup.deleting")}
				pending={deleteEmbed.isPending}
				error={error ?? undefined}
				typeToConfirm={{
					value: embed.name,
					label: t("embedSetup.confirmLabel", { name: embed.name }),
					placeholder: embed.name,
				}}
				onConfirm={() => void onConfirm()}
			/>
		</>
	)
}
