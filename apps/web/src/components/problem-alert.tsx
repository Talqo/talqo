import { getProblemMessage } from "@/lib/problem-message"
import { Button } from "@talqo/ui/components/button"
import { cn } from "@talqo/ui/lib/utils"
import { useTranslation } from "react-i18next"

export function ProblemAlert({
	error,
	className,
	onRetry,
}: {
	error: unknown
	className?: string
	onRetry?: () => void
}) {
	const { t } = useTranslation()
	return error ? (
		<div className="space-y-2">
			<p role="alert" className={cn("text-destructive text-sm", className)}>
				{getProblemMessage(error, t, t("auth.errorFallback"))}
			</p>
			{onRetry ? (
				<Button variant="outline" onClick={onRetry}>
					{t("common.retry")}
				</Button>
			) : null}
		</div>
	) : null
}
