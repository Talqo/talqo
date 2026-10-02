import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { useTranslation } from "react-i18next"

// `resource` names what was denied, so the same card serves every gated page.
export function AccessDenied({ resource }: { resource: string }) {
	const { t } = useTranslation()
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("permissions.accessDeniedTitle")}</CardTitle>
				<CardDescription>{t("permissions.accessDeniedDescription", { resource })}</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="text-muted-foreground text-sm">{t("permissions.accessDeniedBody")}</p>
			</CardContent>
		</Card>
	)
}
