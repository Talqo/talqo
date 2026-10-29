import { ConfirmDialog } from "@talqo/ui/components/confirm-dialog"
import { useBlocker } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

export function useDirtyFormGuard(isDirty: boolean) {
	const { t } = useTranslation()
	const blocker = useBlocker({
		shouldBlockFn: ({ current, next }) => current.pathname !== next.pathname && isDirty,
		enableBeforeUnload: isDirty,
		withResolver: true,
	})

	return (
		<ConfirmDialog
			open={blocker.status === "blocked"}
			onOpenChange={(open) => {
				if (!open) blocker.reset?.()
			}}
			title={t("common.discardTitle")}
			description={t("common.discardDescription")}
			cancelLabel={t("common.keepEditing")}
			confirmLabel={t("common.discardChanges")}
			onConfirm={() => blocker.proceed?.()}
		/>
	)
}
