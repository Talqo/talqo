import { useGetWidget } from "@/api/generated/widget/widget.ts"
import { WidgetPreview } from "@/features/widgets/components/widget-preview"
import { toAppearance, toFormValues } from "@/features/widgets/widget-appearance-form"
import { Button } from "@talqo/ui/components/button"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/widget-preview")({
	// Only the widget id: the appearance is read from the saved record, so a shared
	// link can never drift from what the widget actually looks like.
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
					widgetId ? <Link to="/dashboard/widgets/$widgetId" params={{ widgetId }} /> : <Link to="/dashboard/widgets" />
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
				<WidgetPreview appearance={toAppearance(toFormValues(widget))} previewKey={widget.id} title={widget.name} />
			) : (
				<p className="text-muted-foreground mt-4">{t("widgetSetup.notFound")}</p>
			)}
		</div>
	)
}
