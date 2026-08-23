import { ApiError, FORBIDDEN_STATUS } from "@/api/errors.ts"
import { PageHeader } from "@/components/page-header"
import { WidgetPreview } from "@/components/widget-preview"
import { useActiveAgent } from "@/features/agents/agents-query"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { isSupportedLanguage, supportedLanguages, type SupportedLanguage } from "@talqo/shared"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Check, Copy, ExternalLink } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

const COPY_FEEDBACK_MS = 2000

import { buildEmbedSnippet, type EmbedPosition, widgetScriptUrl } from "./-embed-snippet"

export const Route = createFileRoute("/dashboard/widget")({
	validateSearch: (search: Record<string, unknown>) => ({
		agent: typeof search.agent === "string" ? search.agent : undefined,
	}),
	component: WidgetPage,
})

const positions: EmbedPosition[] = ["bottom-right", "bottom-left"]

const embedLanguages = Object.entries(supportedLanguages).map(([value, label]) => ({ value, label }))

type EmbedLanguage = SupportedLanguage

const isEmbedLanguage = isSupportedLanguage

function WidgetPage() {
	const { t } = useTranslation()
	const { agents, error, isLoading, activeId: activeAgentId, setSelectedId } = useActiveAgent()
	const [copied, setCopied] = useState(false)
	const copyTimeout = useRef<number | undefined>(undefined)
	const [accentColor, setAccentColor] = useState("#1a7f4b")
	const [position, setPosition] = useState<EmbedPosition>("bottom-right")
	const [widgetLanguage, setWidgetLanguage] = useState<EmbedLanguage>("en")

	useEffect(() => {
		return () => window.clearTimeout(copyTimeout.current)
	}, [])

	const scriptUrl = widgetScriptUrl()
	const activeToken = agents?.find((agent) => agent.id === activeAgentId)?.embedToken
	const snippet =
		scriptUrl && activeToken
			? buildEmbedSnippet(scriptUrl, {
					embedToken: activeToken,
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
			copyTimeout.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
		} catch {
			setCopied(false)
		}
	}

	if (error instanceof ApiError && error.status === FORBIDDEN_STATUS) {
		return (
			<div className="mx-auto max-w-5xl space-y-6">
				<PageHeader title={t("widgetSetup.heading")} description={t("widgetSetup.subheading")} />
				<AccessDenied />
			</div>
		)
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
					) : !agents?.length ? (
						<p className="text-muted-foreground">{t("widgetSetup.empty")}</p>
					) : (
						<>
							<div className="max-w-xs space-y-2">
								<Label htmlFor="embed-agent">{t("widgetSetup.agentLabel")}</Label>
								<Select value={activeAgentId} onValueChange={(value) => setSelectedId(value ?? "")}>
									<SelectTrigger id="embed-agent" className="w-full">
										<SelectValue placeholder={t("widgetSetup.selectAgent")} />
									</SelectTrigger>
									<SelectContent>
										{agents.map((agent) => (
											<SelectItem key={agent.id} value={agent.id}>
												{agent.name}
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
							<Select
								value={position}
								onValueChange={(value) => {
									if (value === "bottom-right" || value === "bottom-left") {
										setPosition(value)
									}
								}}
							>
								<SelectTrigger id="widget-position" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{positions.map((option) => (
										<SelectItem key={option} value={option}>
											{option === "bottom-right"
												? t("widgetSetup.positionBottomRight")
												: t("widgetSetup.positionBottomLeft")}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="widget-language">{t("widgetSetup.language")}</Label>
							<Select
								value={widgetLanguage}
								onValueChange={(value) => {
									if (isEmbedLanguage(value)) {
										setWidgetLanguage(value)
									}
								}}
							>
								<SelectTrigger id="widget-language" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{embedLanguages.map((option) => (
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
								<span className="text-muted-foreground ml-2 text-xs">{t("widgetSetup.previewSiteLabel")}</span>
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
