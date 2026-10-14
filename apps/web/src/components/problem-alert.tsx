import { getProblemMessage } from "@/lib/problem-message"
import { cn } from "@talqo/ui/lib/utils"
import { useTranslation } from "react-i18next"

export function ProblemAlert({ error, className }: { error: unknown; className?: string }) {
	const { t } = useTranslation()
	return error ? (
		<p role="alert" className={cn("text-destructive text-sm", className)}>
			{getProblemMessage(error, t, t("auth.errorFallback"))}
		</p>
	) : null
}
