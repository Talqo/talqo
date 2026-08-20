import { useListAgents } from "@/api/generated/agent/agent.ts"
import { PageHeader } from "@/components/page-header"
import { ColorField } from "@/features/widgets/components/color-field"
import { WidgetPreview } from "@/features/widgets/components/widget-preview"
import { apiOriginOverride, buildEmbedSnippet, widgetScriptUrl } from "@/features/widgets/embed-snippet"
import {
	toAppearance,
	toFormValues,
	widgetFormSchema,
	type WidgetFormValues,
} from "@/features/widgets/widget-appearance-form"
import { useUpdateWidget } from "@/features/widgets/widget-mutation"
import { useWidget } from "@/features/widgets/widgets-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { isSupportedLanguage, supportedLanguages } from "@talqo/shared/languages"
import { isWidgetPosition, isWidgetTheme, WIDGET_POSITIONS, WIDGET_THEMES } from "@talqo/shared/widget-appearance"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Switch } from "@talqo/ui/components/switch"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft, Check, Copy, ExternalLink } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

const COPY_FEEDBACK_MS = 2000

export const Route = createFileRoute("/dashboard/widgets/$widgetId")({
	component: WidgetDetailPage,
})

function positionLabel(position: (typeof WIDGET_POSITIONS)[number], t: (key: string) => string): string {
	return position === "bottom-right" ? t("widgetSetup.positionBottomRight") : t("widgetSetup.positionBottomLeft")
}

function themeLabel(theme: (typeof WIDGET_THEMES)[number], t: (key: string) => string): string {
	switch (theme) {
		case "light":
			return t("widgetSetup.themeLight")
		case "dark":
			return t("widgetSetup.themeDark")
		default:
			return t("widgetSetup.themeSystem")
	}
}

function WidgetDetailPage() {
	const { t } = useTranslation()
	const { widgetId } = Route.useParams()
	const { data: widget, isLoading, isError } = useWidget(widgetId)
	const { data: agentsResponse } = useListAgents()
	const agents = agentsResponse?.data.agents
	const updateWidget = useUpdateWidget(widgetId)
	const [copied, setCopied] = useState(false)
	const copyTimeout = useRef<number | undefined>(undefined)

	const { register, handleSubmit, reset, control, watch, formState } = useForm<WidgetFormValues>({
		resolver: zodResolver(widgetFormSchema),
		// Server state flows in through `values`, and keepDirtyValues protects fields the
		// operator has already edited: a background refetch must never discard their typing.
		values: widget ? toFormValues(widget) : undefined,
		resetOptions: { keepDirtyValues: true },
	})

	useEffect(() => {
		return () => window.clearTimeout(copyTimeout.current)
	}, [])

	// The preview follows the form, not the server, so it updates before a save.
	const values = watch()
	const appearance = toAppearance(values)

	const scriptUrl = widgetScriptUrl()
	const snippet =
		scriptUrl && widget
			? buildEmbedSnippet(scriptUrl, {
					publicToken: widget.publicToken,
					apiOrigin: apiOriginOverride(scriptUrl, window.location.origin),
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

	function onValid(submitted: WidgetFormValues) {
		updateWidget.mutate(
			{
				name: submitted.name.trim(),
				agentId: submitted.agentId,
				appearance: toAppearance(submitted),
			},
			// Re-sync once the save lands so the server's stored values show through and
			// the fields go clean again.
			{ onSuccess: (saved) => reset(toFormValues(saved)) },
		)
	}

	if (isLoading) {
		return <p className="text-muted-foreground">{t("widgetSetup.loading")}</p>
	}
	if (isError || !widget) {
		return <p className="text-muted-foreground">{t("widgetSetup.notFound")}</p>
	}

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<Button render={<Link to="/dashboard/widgets" />} nativeButton={false} variant="ghost" className="-ml-2">
				<ArrowLeft className="size-4" />
				{t("widgetSetup.backToWidgets")}
			</Button>

			<PageHeader
				title={widget.name}
				description={t("widgetSetup.detailSubheading")}
				actions={
					<Button
						render={<Link to="/widget-preview" search={{ widget: widgetId }} />}
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
				<CardContent>
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
				</CardContent>
			</Card>

			<div className="grid gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>{t("widgetSetup.appearance")}</CardTitle>
						<CardDescription>{t("widgetSetup.appearanceDescription")}</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit(onValid)} className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="widget-name">{t("widgetSetup.nameLabel")}</Label>
								<Input id="widget-name" aria-invalid={formState.errors.name ? true : undefined} {...register("name")} />
							</div>

							<div className="space-y-2">
								<Label htmlFor="widget-agent">{t("widgetSetup.agentLabel")}</Label>
								<Controller
									control={control}
									name="agentId"
									render={({ field }) => (
										<Select value={field.value} onValueChange={(value) => field.onChange(value ?? "")}>
											<SelectTrigger id="widget-agent" className="w-full">
												<SelectValue placeholder={t("widgetSetup.selectAgent")} />
											</SelectTrigger>
											<SelectContent>
												{agents?.map((agent) => (
													<SelectItem key={agent.id} value={agent.id}>
														{agent.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									)}
								/>
								<p className="text-muted-foreground text-xs">{t("widgetSetup.agentHelp")}</p>
							</div>

							<Controller
								control={control}
								name="primary"
								render={({ field }) => (
									<ColorField
										id="color-primary"
										label={t("widgetSetup.colorPrimary")}
										value={field.value}
										onChange={field.onChange}
										against={values.primaryForeground}
									/>
								)}
							/>
							<Controller
								control={control}
								name="primaryForeground"
								render={({ field }) => (
									<ColorField
										id="color-primary-foreground"
										label={t("widgetSetup.colorPrimaryForeground")}
										value={field.value}
										onChange={field.onChange}
										against={values.primary}
									/>
								)}
							/>
							<Controller
								control={control}
								name="background"
								render={({ field }) => (
									<ColorField
										id="color-background"
										label={t("widgetSetup.colorBackground")}
										value={field.value}
										onChange={field.onChange}
										against={values.foreground}
									/>
								)}
							/>
							<Controller
								control={control}
								name="foreground"
								render={({ field }) => (
									<ColorField
										id="color-foreground"
										label={t("widgetSetup.colorForeground")}
										value={field.value}
										onChange={field.onChange}
										against={values.background}
									/>
								)}
							/>
							<p className="text-muted-foreground text-xs">{t("widgetSetup.colorsHelp")}</p>

							<div className="space-y-2">
								<Label htmlFor="widget-position">{t("widgetSetup.position")}</Label>
								<Controller
									control={control}
									name="position"
									render={({ field }) => (
										<Select
											value={field.value}
											onValueChange={(value) => isWidgetPosition(value) && field.onChange(value)}
										>
											<SelectTrigger id="widget-position" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{WIDGET_POSITIONS.map((option) => (
													<SelectItem key={option} value={option}>
														{positionLabel(option, t)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									)}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="widget-theme">{t("widgetSetup.theme")}</Label>
								<Controller
									control={control}
									name="theme"
									render={({ field }) => (
										<Select
											value={field.value}
											onValueChange={(value) => isWidgetTheme(value) && field.onChange(value)}
										>
											<SelectTrigger id="widget-theme" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{WIDGET_THEMES.map((option) => (
													<SelectItem key={option} value={option}>
														{themeLabel(option, t)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									)}
								/>
							</div>

							<div className="flex items-center gap-2">
								<Controller
									control={control}
									name="themeToggle"
									render={({ field }) => (
										<Switch id="widget-theme-toggle" checked={field.value} onCheckedChange={field.onChange} />
									)}
								/>
								<Label htmlFor="widget-theme-toggle">{t("widgetSetup.themeToggle")}</Label>
							</div>

							<div className="space-y-2">
								<Label htmlFor="widget-language">{t("widgetSetup.language")}</Label>
								<Controller
									control={control}
									name="language"
									render={({ field }) => (
										<Select
											value={field.value}
											onValueChange={(value) => isSupportedLanguage(value) && field.onChange(value)}
										>
											<SelectTrigger id="widget-language" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{Object.entries(supportedLanguages).map(([value, label]) => (
													<SelectItem key={value} value={value}>
														{label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									)}
								/>
							</div>

							{updateWidget.isError && (
								<p role="alert" className="text-destructive text-sm">
									{t("widgetSetup.saveError")}
								</p>
							)}
							<div className="flex items-center gap-3 pt-2">
								<Button type="submit" disabled={updateWidget.isPending}>
									{updateWidget.isPending ? t("widgetSetup.saving") : t("widgetSetup.save")}
								</Button>
								{updateWidget.isSuccess && !updateWidget.isPending && (
									<span className="text-muted-foreground text-sm">{t("widgetSetup.saved")}</span>
								)}
							</div>
						</form>
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
								<WidgetPreview appearance={appearance} previewKey={widgetId} />
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
