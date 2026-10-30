import { getProblemMessage } from "@/lib/problem-message"
import { Button } from "@talqo/ui/components/button"
import { CircleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

export function ProblemAlert({
	error,
	message,
	fallback,
	onRetry,
}: {
	error?: unknown
	message?: string
	fallback?: string
	onRetry?: () => void
}) {
	const { t } = useTranslation()
	const copy = message ?? (error ? getProblemMessage(error, t, fallback ?? t("auth.errorFallback")) : fallback)
	return copy ? (
		<div
			role="alert"
			className="rounded-surface border-destructive/30 bg-destructive/10 p-surface-padding flex flex-wrap items-center gap-3 border text-sm"
		>
			<div className="flex min-w-0 flex-1 basis-64 items-start gap-2">
				<CircleAlertIcon aria-hidden="true" className="text-destructive mt-0.5 size-4 shrink-0" />
				<p className="text-foreground min-w-0">{copy}</p>
			</div>
			{onRetry ? (
				<Button variant="outline" size="sm" className="shrink-0" onClick={onRetry}>
					{t("common.retry")}
				</Button>
			) : null}
		</div>
	) : null
}
