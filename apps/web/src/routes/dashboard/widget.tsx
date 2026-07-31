import { PageHeader } from "@/components/page-header"
import { WidgetPreview } from "@/components/widget-preview"
import { useActiveWidget } from "@/features/widgets/widgets-query"
import { type DashboardLanguage, dashboardLanguages } from "@/lib/languages"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Switch } from "@talqo/ui/components/switch"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Check, Copy, ExternalLink } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/widget")({
	// Selected bot lives in the URL so the page is shareable; see
	// features/widgets/widgets-query.ts useActiveWidget.
	validateSearch: (search: Record<string, unknown>) => ({
		bot: typeof search.bot === "string" ? search.bot : undefined,
	}),
	component: WidgetPage,
})

// No defer/async: document.currentScript is how the bundle reads its own
// data-talqo-bot configuration (see apps/widget/src/widget.tsx).
function buildEmbedSnippet(botId: string) {
	return ["<script", '  src="https://cdn.talqo.dev/widget.js"', `  data-talqo-bot="${botId}"`, "></script>"].join("\n")
}

const positions = [
	{ value: "bottom-right", labelKey: "widgetSetup.positionBottomRight" },
	{ value: "bottom-left", labelKey: "widgetSetup.positionBottomLeft" },
] as const

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
	const [position, setPosition] = useState<"bottom-right" | "bottom-left">("bottom-right")
	const [showThemeSwitch, setShowThemeSwitch] = useState(true)
	// Shared with the dashboard header language switch (see lib/use-language).
	const { language, setLanguage } = useLanguage()
	const [avatarUrl, setAvatarUrl] = useState("")

	useEffect(() => {
		return () => window.clearTimeout(copyTimeout.current)
	}, [])

	const snippet = buildEmbedSnippet(activeBotId)

	async function copySnippet() {
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
						render={<Link to="/widget-preview" search={{ accent: accentColor, position, language }} />}
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
							<Select value={position} onValueChange={(value) => setPosition(value as "bottom-right" | "bottom-left")}>
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
							<Select value={language} onValueChange={(value) => setLanguage(value as DashboardLanguage)}>
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
						<div className="space-y-2">
							<Label htmlFor="avatar-url">{t("widgetSetup.avatarUrl")}</Label>
							<Input
								id="avatar-url"
								type="url"
								placeholder="https://example.com/avatar.png"
								value={avatarUrl}
								onChange={(event) => setAvatarUrl(event.target.value)}
							/>
						</div>
						<div className="flex items-center gap-2">
							<Switch id="theme-switch" checked={showThemeSwitch} onCheckedChange={setShowThemeSwitch} />
							<Label htmlFor="theme-switch">{t("widgetSetup.themeSwitch")}</Label>
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
							<div className="bg-background relative h-[452px]">
								<WidgetPreview accent={accentColor} position={position} language={language} />
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
