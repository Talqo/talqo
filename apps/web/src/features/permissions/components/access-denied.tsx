import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { useTranslation } from "react-i18next"

// Rendered by the dashboard layout in place of the page, so it deliberately
// names no resource: the copy cannot go stale when a page moves.
export function AccessDenied() {
	const { t } = useTranslation()
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("permissions.accessDeniedTitle")}</CardTitle>
				<CardDescription>{t("permissions.accessDeniedDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="text-muted-foreground text-sm">{t("permissions.accessDeniedBody")}</p>
			</CardContent>
		</Card>
	)
}
