import { getGetEmbedQueryKey, useGetEmbed } from "@/api/generated/embed/embed.ts"
import { WidgetPreview } from "@/features/embeds/components/widget-preview"
import { toAppearance, toFormValues } from "@/features/embeds/embed-appearance-form"
import { Button } from "@talqo/ui/components/button"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/embed-preview")({
	// The id only: appearance comes from the saved record, so a shared link cannot drift.
	validateSearch: (search: Record<string, unknown>) => ({
		embed: typeof search.embed === "string" ? search.embed : "",
	}),
	component: EmbedPreviewPage,
})

function EmbedPreviewPage() {
	const { t } = useTranslation()
	const { embed: embedId } = Route.useSearch()
	// The generated hook only gates on null/undefined, so an empty id would call the list endpoint.
	const { data: embedResponse, isLoading } = useGetEmbed(embedId, {
		query: { queryKey: getGetEmbedQueryKey(embedId), enabled: embedId !== "" },
	})
	const embed = embedResponse?.data.embed

	return (
		<div className="bg-background text-foreground relative min-h-screen p-6">
			<Button
				render={
					embedId ? (
						<Link to="/dashboard/embeds/$embedId" params={{ embedId }} search={{ colorTab: undefined }} />
					) : (
						<Link to="/dashboard/agents" />
					)
				}
				nativeButton={false}
				variant="outline"
			>
				<ArrowLeft className="size-4" />
				{t("embedSetup.backToSetup")}
			</Button>
			{isLoading ? (
				<p className="text-muted-foreground mt-4">{t("embedSetup.loading")}</p>
			) : embed ? (
				<WidgetPreview appearance={toAppearance(toFormValues(embed))} title={embed.name} previewKey={embed.id} />
			) : (
				<p className="text-muted-foreground mt-4">{t("embedSetup.notFound")}</p>
			)}
		</div>
	)
}
