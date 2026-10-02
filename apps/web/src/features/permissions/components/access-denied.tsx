import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { LockIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

// Names no resource, so the copy cannot go stale when a page moves.
export function AccessDenied() {
	const { t } = useTranslation()
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<LockIcon className="text-muted-foreground size-5" aria-hidden />
					<CardTitle>{t("permissions.accessDeniedTitle")}</CardTitle>
				</div>
				<CardDescription>{t("permissions.accessDeniedDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="text-muted-foreground text-sm">{t("permissions.accessDeniedBody")}</p>
			</CardContent>
		</Card>
	)
}
