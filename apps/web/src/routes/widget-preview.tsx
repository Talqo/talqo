import { WidgetPreview } from "@/components/widget-preview"
import { isDashboardLanguage } from "@/lib/languages"
import { Button } from "@talqo/ui/components/button"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/widget-preview")({
	validateSearch: (search: Record<string, unknown>) => ({
		accent: typeof search.accent === "string" ? search.accent : undefined,
		position: search.position === "bottom-left" ? ("bottom-left" as const) : ("bottom-right" as const),
		language: isDashboardLanguage(search.language) ? search.language : undefined,
	}),
	component: WidgetPreviewPage,
})

function WidgetPreviewPage() {
	const { t } = useTranslation()
	const { accent, position, language } = Route.useSearch()

	return (
		<div className="bg-background text-foreground relative min-h-screen p-6">
			<Button
				render={<Link to="/dashboard/widget" search={{ bot: undefined }} />}
				nativeButton={false}
				variant="outline"
			>
				<ArrowLeft className="size-4" />
				{t("widgetSetup.backToSetup")}
			</Button>
			<WidgetPreview accent={accent} position={position} language={language} />
		</div>
	)
}
