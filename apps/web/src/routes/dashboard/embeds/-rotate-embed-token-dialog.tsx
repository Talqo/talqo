import { getGetEmbedQueryKey, getListEmbedsQueryKey, useRotateEmbedToken } from "@/api/generated/embed/embed.ts"
import { getProblemMessage } from "@/lib/problem-message"
import { Button } from "@talqo/ui/components/button"
import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

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
			setError(getProblemMessage(caught, t, t("embedSetup.rotateTokenFailed")))
		}
	}

	return (
		<>
			<Button
				variant="outline"
				onClick={() => {
					setError(null)
					rotateToken.reset()
					setOpen(true)
				}}
			>
				<RefreshCw className="size-4" />
				{t("embedSetup.rotateToken")}
			</Button>
			<ConfirmDialog
				open={open}
				onOpenChange={(next: boolean) => {
					setOpen(next)
					if (!next) {
						setError(null)
						rotateToken.reset()
					}
				}}
				title={t("embedSetup.rotateTokenTitle")}
				description={t("embedSetup.rotateTokenWarning")}
				cancelLabel={t("embedSetup.cancel")}
				confirmLabel={t("embedSetup.rotateToken")}
				pendingLabel={t("embedSetup.rotating")}
				pending={rotateToken.isPending}
				error={error ?? undefined}
				onConfirm={() => void onConfirm()}
			/>
		</>
	)
}
