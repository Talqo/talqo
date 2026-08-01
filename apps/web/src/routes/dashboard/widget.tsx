import { PageHeader } from "@/components/page-header"
import { WidgetPreview } from "@/components/widget-preview"
import { useActiveWidget } from "@/features/widgets/widgets-query"
import { type DashboardLanguage, dashboardLanguages } from "@/lib/languages"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Check, Copy, ExternalLink } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { buildEmbedSnippet, type EmbedPosition, widgetScriptUrl } from "./-embed-snippet"

export const Route = createFileRoute("/dashboard/widget")({
	// Selected bot lives in the URL so the page is shareable; see
	// features/widgets/widgets-query.ts useActiveWidget.
	validateSearch: (search: Record<string, unknown>) => ({
		bot: typeof search.bot === "string" ? search.bot : undefined,
	}),
	component: WidgetPage,
})

const positions: { value: EmbedPosition; labelKey: string }[] = [
	{ value: "bottom-right", labelKey: "widgetSetup.positionBottomRight" },
	{ value: "bottom-left", labelKey: "widgetSetup.positionBottomLeft" },
]

const languages = Object.entries(dashboardLanguages).map(([value, label]) => ({
	value: value as DashboardLanguage,
	label,
}))

function WidgetPage() {
	const { t } = useTranslation()
	const { widgets, isLoading, activeId: activeBotId, setSelectedId } = useActiveWidget()
	const [copied, setCopied] = useState(false)
	const copyTimeout = useRef<number | undefined>(undefined)
	const [accentColor, setAccentColor] = useState("#1a7f4b")
	const [position, setPosition] = useState<EmbedPosition>("bottom-right")
	// The widget's end-user language is embed configuration; it stays separate
	// from the operator's dashboard UI language (lib/use-language).
	const [widgetLanguage, setWidgetLanguage] = useState<DashboardLanguage>("en")

	useEffect(() => {
		return () => window.clearTimeout(copyTimeout.current)
	}, [])

	const scriptUrl = widgetScriptUrl()
	const snippet = scriptUrl
		? buildEmbedSnippet(scriptUrl, {
				botId: activeBotId,
				accent: accentColor,
				language: widgetLanguage,
				position,
			})
		: undefined

	async function copySnippet() {
		if (!snippet) {
			return
		}
		try {
			await navigator.clipboard.writeText(snippet)
			setCopied(true)
			window.clearTimeout(copyTimeout.current)
			copyTimeout.current = window.setTimeout(() => setCopied(false), 2000)
		} catch {
			setCopied(false)
		}
	}

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<PageHeader
				title={t("widgetSetup.heading")}
				description={t("widgetSetup.subheading")}
				actions={
					<Button
						render={<Link to="/widget-preview" search={{ accent: accentColor, position, language: widgetLanguage }} />}
						nativeButton={false}
						variant="outline"
					>
						<ExternalLink className="size-4" />
						{t("widgetSetup.openFullPreview")}
					</Button>
				}
			/>

			<Card>
				<CardHeader>
					<CardTitle>{t("widgetSetup.embedCode")}</CardTitle>
					<CardDescription>{t("widgetSetup.embedDescription")}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{isLoading ? (
						<p className="text-muted-foreground">{t("widgetSetup.loading")}</p>
					) : !widgets?.length ? (
						<p className="text-muted-foreground">{t("widgetSetup.empty")}</p>
					) : (
						<>
							<div className="max-w-xs space-y-2">
								<Label htmlFor="embed-bot">{t("widgetSetup.botLabel")}</Label>
								<Select value={activeBotId} onValueChange={(value) => setSelectedId(value ?? "")}>
									<SelectTrigger id="embed-bot" className="w-full">
										<SelectValue placeholder={t("widgetSetup.selectBot")} />
									</SelectTrigger>
									<SelectContent>
										{widgets.map((widget) => (
											<SelectItem key={widget.id} value={widget.id}>
												{widget.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							{snippet ? (
								<div className="relative">
									<pre className="bg-muted overflow-x-auto rounded-lg border p-4 font-mono text-sm">{snippet}</pre>
									<Button
										variant="outline"
										size="icon"
										className="absolute top-2 right-2"
										onClick={copySnippet}
										aria-label={t("widgetSetup.copyEmbed")}
									>
										{copied ? <Check className="text-primary size-4" /> : <Copy className="size-4" />}
									</Button>
								</div>
							) : (
								<p className="text-muted-foreground">{t("widgetSetup.scriptUrlMissing")}</p>
							)}
						</>
					)}
				</CardContent>
			</Card>

			<div className="grid gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>{t("widgetSetup.appearance")}</CardTitle>
						<CardDescription>{t("widgetSetup.appearanceDescription")}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="accent-color">{t("widgetSetup.accentColor")}</Label>
							<div className="flex items-center gap-2">
								<input
									id="accent-color"
									type="color"
									value={accentColor}
									onChange={(event) => setAccentColor(event.target.value)}
									className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
								/>
								<Input
									value={accentColor}
									onChange={(event) => setAccentColor(event.target.value)}
									className="w-28 font-mono"
									aria-label={t("widgetSetup.accentHex")}
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="widget-position">{t("widgetSetup.position")}</Label>
							<Select value={position} onValueChange={(value) => setPosition(value as EmbedPosition)}>
								<SelectTrigger id="widget-position" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{positions.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{t(option.labelKey)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="widget-language">{t("widgetSetup.language")}</Label>
							<Select value={widgetLanguage} onValueChange={(value) => setWidgetLanguage(value as DashboardLanguage)}>
								<SelectTrigger id="widget-language" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{languages.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<p className="text-muted-foreground text-xs">{t("widgetSetup.notPersisted")}</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>{t("widgetSetup.livePreview")}</CardTitle>
						<CardDescription>{t("widgetSetup.livePreviewDescription")}</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="overflow-hidden rounded-lg border">
							<div className="bg-muted flex items-center gap-1.5 border-b px-3 py-2">
								<span className="bg-destructive/70 size-2.5 rounded-full" />
								<span className="bg-chart-4 size-2.5 rounded-full" />
								<span className="bg-primary/70 size-2.5 rounded-full" />
								<span className="text-muted-foreground ml-2 text-xs">your-site.com</span>
							</div>
							<div className="bg-background relative h-[460px]">
								<WidgetPreview accent={accentColor} position={position} language={widgetLanguage} />
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
