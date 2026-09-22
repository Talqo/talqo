import {
	getGetEmbedQueryKey,
	getListEmbedsQueryKey,
	type RotateEmbedTokenMutationError,
	useRotateEmbedToken,
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
import { RefreshCw } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

const NOT_FOUND_STATUS = 404

export function RotateEmbedTokenDialog({ embedId }: { embedId: string }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const rotateToken = useRotateEmbedToken({
		mutation: {
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: getGetEmbedQueryKey(embedId) })
				await queryClient.invalidateQueries({ queryKey: getListEmbedsQueryKey() })
			},
		},
	})
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function onConfirm() {
		setError(null)
		try {
			await rotateToken.mutateAsync({ embedId })
			setOpen(false)
		} catch (caught) {
			setError(
				(caught as RotateEmbedTokenMutationError).status === NOT_FOUND_STATUS
					? t("embedSetup.notFound")
					: t("embedSetup.rotateTokenFailed"),
			)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Button variant="outline" onClick={() => setOpen(true)}>
				<RefreshCw className="size-4" />
				{t("embedSetup.rotateToken")}
			</Button>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("embedSetup.rotateTokenTitle")}</DialogTitle>
					<DialogDescription>{t("embedSetup.rotateTokenWarning")}</DialogDescription>
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
					<Button variant="destructive" disabled={rotateToken.isPending} onClick={onConfirm}>
						{rotateToken.isPending ? t("embedSetup.rotating") : t("embedSetup.rotateToken")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
