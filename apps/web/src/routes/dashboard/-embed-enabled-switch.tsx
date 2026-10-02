import {
	type DisableEmbedMutationError,
	type EnableEmbedMutationError,
	getGetEmbedQueryKey,
	getListEmbedsQueryKey,
	useDisableEmbed,
	useEnableEmbed,
} from "@/api/generated/embed/embed.ts"
import { Switch } from "@talqo/ui/components/switch"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"

const NOT_FOUND_STATUS = 404

type EmbedTarget = { id: string; agentId: string; isDisabled: boolean }

export function EmbedEnabledSwitch({ embed }: { embed: EmbedTarget }) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const invalidateEmbed = async () => {
		await queryClient.invalidateQueries({ queryKey: getGetEmbedQueryKey(embed.id) })
		await queryClient.invalidateQueries({ queryKey: getListEmbedsQueryKey({ agentId: embed.agentId }) })
	}
	const disableEmbed = useDisableEmbed({ mutation: { onSuccess: invalidateEmbed } })
	const enableEmbed = useEnableEmbed({ mutation: { onSuccess: invalidateEmbed } })
	const [error, setError] = useState<string | null>(null)

	const pending = disableEmbed.isPending || enableEmbed.isPending

	async function onToggle(enabled: boolean) {
		setError(null)
		try {
			if (enabled) {
				await enableEmbed.mutateAsync({ embedId: embed.id })
			} else {
				await disableEmbed.mutateAsync({ embedId: embed.id })
			}
		} catch (caught) {
			setError(
				(caught as EnableEmbedMutationError | DisableEmbedMutationError).status === NOT_FOUND_STATUS
					? t("embedSetup.notFound")
					: enabled
						? t("embedSetup.enableEmbedFailed")
						: t("embedSetup.disableEmbedFailed"),
			)
		}
	}

	return (
		<div>
			<div className="flex items-center gap-2">
				<Switch
					checked={!embed.isDisabled}
					disabled={pending}
					onCheckedChange={(checked) => void onToggle(checked)}
					aria-label={t("embedSetup.embedEnabled")}
				/>
				<span className="text-muted-foreground text-sm">{t("embedSetup.embedEnabled")}</span>
			</div>
			{error && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
		</div>
	)
}
