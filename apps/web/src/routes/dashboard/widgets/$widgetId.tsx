import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import {
	getGetWidgetQueryKey,
	getListWidgetsQueryKey,
	useGetWidget,
	useUpdateWidget,
} from "@/api/generated/widget/widget.ts"
import { PageHeader } from "@/components/page-header"
import { WidgetPreview } from "@/features/widgets/components/widget-preview"
import {
	toAppearance,
	toFormValues,
	WIDGET_FORM_DEFAULTS,
	widgetFormSchema,
	type WidgetFormValues,
} from "@/features/widgets/widget-appearance-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { isSupportedLanguage, supportedLanguages } from "@talqo/shared/languages"
import { isWidgetPosition, isWidgetTheme, WIDGET_POSITIONS, WIDGET_THEMES } from "@talqo/shared/widget-appearance"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Switch } from "@talqo/ui/components/switch"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft, Check, Copy, ExternalLink } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { ColorField } from "./-color-field"
import { apiOriginOverride, buildEmbedSnippet, widgetScriptUrl } from "./-embed-snippet"

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
	const queryClient = useQueryClient()
	const { data: widgetResponse, isLoading, isError } = useGetWidget(widgetId)
	const widget = widgetResponse?.data.widget
	const { data: agentsResponse } = useListAgents()
	const agents = agentsResponse?.data.agents
	const permissions = useGetMyPermissions().data?.data.permissions
	const canManage = permissions?.includes("agents:manage") ?? false
	const updateWidget = useUpdateWidget({
		mutation: {
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: getGetWidgetQueryKey(widgetId) })
				await queryClient.invalidateQueries({ queryKey: getListWidgetsQueryKey() })
			},
		},
	})
	const [copied, setCopied] = useState(false)
	const copyTimeout = useRef<number | undefined>(undefined)

	const { register, handleSubmit, reset, control, formState } = useForm<WidgetFormValues>({
		resolver: zodResolver(widgetFormSchema),
		// `values` is applied in an effect, one render after the fields mount, so without
		// defaults the selects would mount uncontrolled and stay blank once it lands.
		defaultValues: { name: "", agentId: "", ...WIDGET_FORM_DEFAULTS },
		// Server state flows in through `values`, and keepDirtyValues protects fields the
		// operator has already edited: a background refetch must never discard their typing.
		values: widget ? toFormValues(widget) : undefined,
		resetOptions: { keepDirtyValues: true },
	})

	useEffect(() => {
		return () => window.clearTimeout(copyTimeout.current)
	}, [])

	// The preview follows the form, not the server, so it updates before a save.
	const appearance = useWatch({ control, compute: toAppearance })

	// Base UI shows the raw value in a closed trigger unless `items` maps it to a label.
	const agentOptions = agents?.map((agent) => ({ value: agent.id, label: agent.name })) ?? []
	const positionOptions = WIDGET_POSITIONS.map((value) => ({ value, label: positionLabel(value, t) }))
	const themeOptions = WIDGET_THEMES.map((value) => ({ value, label: themeLabel(value, t) }))
	const languageOptions = Object.entries(supportedLanguages).map(([value, label]) => ({ value, label }))

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
				widgetId,
				data: {
					name: submitted.name.trim(),
					agentId: submitted.agentId,
					appearance: toAppearance(submitted),
				},
			},
			// Re-sync once the save lands so the server's stored values show through and
			// the fields go clean again.
			{ onSuccess: (saved) => reset(toFormValues(saved.data.widget)) },
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
							{/* Native cascade: one attribute disables every control below, including the
							    Base UI triggers, so a read-only operator reads the widget without editing it. */}
							<fieldset disabled={!canManage} className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="widget-name">{t("widgetSetup.nameLabel")}</Label>
									<Input
										id="widget-name"
										aria-invalid={formState.errors.name ? true : undefined}
										{...register("name")}
									/>
								</div>

								<div className="space-y-2">
									<Label htmlFor="widget-agent">{t("widgetSetup.agentLabel")}</Label>
									<Controller
										control={control}
										name="agentId"
										render={({ field }) => (
											<Select
												items={agentOptions}
												value={field.value}
												onValueChange={(value) => field.onChange(value ?? "")}
											>
												<SelectTrigger id="widget-agent" className="w-full">
													<SelectValue placeholder={t("widgetSetup.selectAgent")} />
												</SelectTrigger>
												<SelectContent>
													{agentOptions.map((option) => (
														<SelectItem key={option.value} value={option.value}>
															{option.label}
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
											against={appearance.primaryForeground}
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
											against={appearance.primary}
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
											against={appearance.foreground}
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
											against={appearance.background}
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
												items={positionOptions}
												value={field.value}
												onValueChange={(value) => isWidgetPosition(value) && field.onChange(value)}
											>
												<SelectTrigger id="widget-position" className="w-full">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{positionOptions.map((option) => (
														<SelectItem key={option.value} value={option.value}>
															{option.label}
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
												items={themeOptions}
												value={field.value}
												onValueChange={(value) => isWidgetTheme(value) && field.onChange(value)}
											>
												<SelectTrigger id="widget-theme" className="w-full">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{themeOptions.map((option) => (
														<SelectItem key={option.value} value={option.value}>
															{option.label}
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
												items={languageOptions}
												value={field.value}
												onValueChange={(value) => isSupportedLanguage(value) && field.onChange(value)}
											>
												<SelectTrigger id="widget-language" className="w-full">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{languageOptions.map((option) => (
														<SelectItem key={option.value} value={option.value}>
															{option.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										)}
									/>
								</div>
							</fieldset>

							{updateWidget.isError && (
								<p role="alert" className="text-destructive text-sm">
									{t("widgetSetup.saveError")}
								</p>
							)}
							{canManage && (
								<div className="flex items-center gap-3 pt-2">
									<Button type="submit" disabled={updateWidget.isPending}>
										{updateWidget.isPending ? t("widgetSetup.saving") : t("widgetSetup.save")}
									</Button>
									{updateWidget.isSuccess && !updateWidget.isPending && (
										<span className="text-muted-foreground text-sm">{t("widgetSetup.saved")}</span>
									)}
								</div>
							)}
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
