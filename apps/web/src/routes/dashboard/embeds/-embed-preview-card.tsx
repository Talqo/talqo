import type { WidgetAppearance } from "@talqo/shared/widget-appearance"

import { WidgetPreview } from "@/features/embeds/components/widget-preview"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Link } from "@tanstack/react-router"
import { ExternalLink } from "lucide-react"
import { useTranslation } from "react-i18next"

type EmbedPreviewCardProps = {
	activeScheme: "light" | "dark"
	appearance: WidgetAppearance
	embedId: string
	title: string | undefined
}

export function EmbedPreviewCard({ activeScheme, appearance, embedId, title }: EmbedPreviewCardProps) {
	const { t } = useTranslation()

	return (
		<Card className="lg:sticky lg:top-24">
			<CardHeader>
				<CardTitle>{t("embedSetup.livePreview")}</CardTitle>
				<CardDescription>{t("embedSetup.livePreviewDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="rounded-surface overflow-hidden border">
					<div className="bg-muted flex h-10 items-center gap-1.5 border-b px-3">
						<div aria-hidden="true" className="flex items-center gap-1.5">
							<span className="bg-destructive/70 size-2.5 rounded-full" />
							<span className="bg-chart-4 size-2.5 rounded-full" />
							<span className="bg-primary/70 size-2.5 rounded-full" />
						</div>
						<span className="text-muted-foreground ml-2 text-xs">{t("embedSetup.previewSiteLabel")}</span>
						<Button
							render={<Link to="/embed-preview" search={{ embed: embedId }} />}
							nativeButton={false}
							variant="ghost"
							size="xs"
							className="ml-auto"
							aria-label={t("embedSetup.openFullPreview")}
						>
							<ExternalLink className="size-3.5" />
							<span className="hidden sm:inline">{t("embedSetup.openFullPreview")}</span>
						</Button>
					</div>
					<div className="bg-background relative h-[420px] overflow-hidden">
						<div aria-hidden="true" className="absolute inset-0 p-6 opacity-70">
							<div className="bg-muted mb-8 h-3 w-24 rounded-full" />
							<div className="bg-muted/70 mb-3 h-2.5 w-3/4 rounded-full" />
							<div className="bg-muted/50 h-2.5 w-1/2 rounded-full" />
							<div className="mt-8 grid grid-cols-2 gap-3">
								<div className="bg-muted/50 h-24 rounded-md border" />
								<div className="bg-muted/30 h-24 rounded-md border" />
							</div>
						</div>
						<WidgetPreview appearance={appearance} title={title} activeScheme={activeScheme} previewKey={embedId} />
					</div>
				</div>
			</CardContent>
		</Card>
	)
}
