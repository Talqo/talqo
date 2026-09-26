import {
	type DisableEmbedMutationError,
	type EnableEmbedMutationError,
	getGetEmbedQueryKey,
	getListEmbedsQueryKey,
	useDisableEmbed,
	useEnableEmbed,
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
import { useQueryClient } from "@tanstack/react-query"
import { Ban, Power } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

const NOT_FOUND_STATUS = 404

type EmbedTarget = { id: string; isDisabled: boolean }

export function DisableEmbedDialog({ embed }: { embed: EmbedTarget }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const invalidateEmbed = async () => {
		await queryClient.invalidateQueries({ queryKey: getGetEmbedQueryKey(embed.id) })
		await queryClient.invalidateQueries({ queryKey: getListEmbedsQueryKey() })
	}
	const disableEmbed = useDisableEmbed({ mutation: { onSuccess: invalidateEmbed } })
	const enableEmbed = useEnableEmbed({ mutation: { onSuccess: invalidateEmbed } })
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function onConfirmDisable() {
		setError(null)
		try {
			await disableEmbed.mutateAsync({ embedId: embed.id })
			setOpen(false)
		} catch (caught) {
			setError(
				(caught as DisableEmbedMutationError).status === NOT_FOUND_STATUS
					? t("embedSetup.notFound")
					: t("embedSetup.disableWidgetFailed"),
			)
		}
	}

	// Re-enabling is harmless and immediate, so it needs no confirmation dialog.
	async function onEnable() {
		setError(null)
		try {
			await enableEmbed.mutateAsync({ embedId: embed.id })
		} catch (caught) {
			setError(
				(caught as EnableEmbedMutationError).status === NOT_FOUND_STATUS
					? t("embedSetup.notFound")
					: t("embedSetup.enableWidgetFailed"),
			)
		}
	}

	if (embed.isDisabled) {
		return (
			<div className="space-y-2">
				<Button variant="outline" disabled={enableEmbed.isPending} onClick={() => void onEnable()}>
					<Power className="size-4" />
					{enableEmbed.isPending ? t("embedSetup.enablingWidget") : t("embedSetup.enableWidget")}
				</Button>
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
			</div>
		)
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Button variant="outline" onClick={() => setOpen(true)}>
				<Ban className="size-4" />
				{t("embedSetup.disableWidget")}
			</Button>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("embedSetup.disableWidgetTitle")}</DialogTitle>
					<DialogDescription>{t("embedSetup.disableWidgetWarning")}</DialogDescription>
				</DialogHeader>
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						{t("embedSetup.cancel")}
					</Button>
					<Button variant="destructive" disabled={disableEmbed.isPending} onClick={() => void onConfirmDisable()}>
						{disableEmbed.isPending ? t("embedSetup.disablingWidget") : t("embedSetup.disableWidget")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
