import { useGetWidget } from "@/api/generated/widget/widget.ts"
import { WidgetPreview } from "@/features/widgets/components/widget-preview"
import { toAppearance, toFormValues } from "@/features/widgets/widget-appearance-form"
import { Button } from "@talqo/ui/components/button"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/widget-preview")({
	// The id only: appearance comes from the saved record, so a shared link cannot drift.
	validateSearch: (search: Record<string, unknown>) => ({
		widget: typeof search.widget === "string" ? search.widget : "",
	}),
	component: WidgetPreviewPage,
})

function WidgetPreviewPage() {
	const { t } = useTranslation()
	const { widget: widgetId } = Route.useSearch()
	const { data: widgetResponse, isLoading } = useGetWidget(widgetId)
	const widget = widgetResponse?.data.widget

	return (
		<div className="bg-background text-foreground relative min-h-screen p-6">
			<Button
				render={
					widgetId ? (
						<Link to="/dashboard/widgets/$widgetId" params={{ widgetId }} search={{ colorTab: undefined }} />
					) : (
						<Link to="/dashboard/agents" />
					)
				}
				nativeButton={false}
				variant="outline"
			>
				<ArrowLeft className="size-4" />
				{t("widgetSetup.backToSetup")}
			</Button>
			{isLoading ? (
				<p className="text-muted-foreground mt-4">{t("widgetSetup.loading")}</p>
			) : widget ? (
				<WidgetPreview appearance={toAppearance(toFormValues(widget))} title={widget.name} previewKey={widget.id} />
			) : (
				<p className="text-muted-foreground mt-4">{t("widgetSetup.notFound")}</p>
			)}
		</div>
	)
}
