import { useListAgents } from "@/api/generated/agent/agent.ts"
import { getGetEmbedQueryKey, getListEmbedsQueryKey, useGetEmbed, useUpdateEmbed } from "@/api/generated/embed/embed.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { WidgetPreview } from "@/features/embeds/components/widget-preview"
import {
	toAppearance,
	toFormValues,
	EMBED_FORM_DEFAULTS,
	embedFormSchema,
	type EmbedFormValues,
} from "@/features/embeds/embed-appearance-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { isSupportedLanguage, supportedLanguages } from "@talqo/shared/languages"
import { isWidgetPosition, isWidgetTheme, WIDGET_POSITIONS, WIDGET_THEMES } from "@talqo/shared/widget-appearance"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Switch } from "@talqo/ui/components/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@talqo/ui/components/tabs"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft, Check, Copy, ExternalLink } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { type Control, Controller, useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { ColorField } from "./-color-field"
import { DeleteEmbedDialog } from "./-delete-embed-dialog"
import { apiOriginOverride, buildEmbedSnippet } from "./-embed-snippet"
import { RotateEmbedTokenDialog } from "./-rotate-embed-token-dialog"

const COPY_FEEDBACK_MS = 2000

const COLOR_SCHEMES = ["light", "dark"] as const
type ColorSchemeTab = (typeof COLOR_SCHEMES)[number]

function isColorSchemeTab(value: unknown): value is ColorSchemeTab {
	return value === "light" || value === "dark"
}

export const Route = createFileRoute("/dashboard/embeds/$embedId")({
	validateSearch: (search: Record<string, unknown>) => ({
		colorTab: isColorSchemeTab(search.colorTab) ? search.colorTab : undefined,
	}),
	component: EmbedDetailPage,
})

function positionLabel(position: (typeof WIDGET_POSITIONS)[number], t: (key: string) => string): string {
	return position === "bottom-right" ? t("embedSetup.positionBottomRight") : t("embedSetup.positionBottomLeft")
}

function themeLabel(theme: (typeof WIDGET_THEMES)[number], t: (key: string) => string): string {
	switch (theme) {
		case "light":
			return t("embedSetup.themeLight")
		case "dark":
			return t("embedSetup.themeDark")
		default:
			return t("embedSetup.themeSystem")
	}
}

function SchemeColorFields({
	scheme,
	control,
	appearanceScheme,
	t,
}: {
	scheme: ColorSchemeTab
	control: Control<EmbedFormValues>
	appearanceScheme: { primary: string; textOnPrimary: string; background: string; surface: string; text: string }
	t: (key: string) => string
}) {
	return (
		<div className="space-y-4">
			<Controller
				control={control}
				name={`${scheme}.primary`}
				render={({ field }) => (
					<ColorField
						id={`color-${scheme}-primary`}
						label={t("embedSetup.colorPrimary")}
						value={field.value}
						onChange={field.onChange}
						against={appearanceScheme.textOnPrimary}
					/>
				)}
			/>
			<Controller
				control={control}
				name={`${scheme}.textOnPrimary`}
				render={({ field }) => (
					<ColorField
						id={`color-${scheme}-text-on-primary`}
						label={t("embedSetup.colorTextOnPrimary")}
						value={field.value}
						onChange={field.onChange}
						against={appearanceScheme.primary}
					/>
				)}
			/>
			<Controller
				control={control}
				name={`${scheme}.background`}
				render={({ field }) => (
					<ColorField
						id={`color-${scheme}-background`}
						label={t("embedSetup.colorBackground")}
						value={field.value}
						onChange={field.onChange}
						against={appearanceScheme.text}
					/>
				)}
			/>
			<Controller
				control={control}
				name={`${scheme}.surface`}
				render={({ field }) => (
					<ColorField
						id={`color-${scheme}-surface`}
						label={t("embedSetup.colorSurface")}
						value={field.value}
						onChange={field.onChange}
						against={appearanceScheme.text}
					/>
				)}
			/>
			<Controller
				control={control}
				name={`${scheme}.text`}
				render={({ field }) => (
					<ColorField
						id={`color-${scheme}-text`}
						label={t("embedSetup.colorText")}
						value={field.value}
						onChange={field.onChange}
						against={appearanceScheme.background}
					/>
				)}
			/>
		</div>
	)
}

function EmbedDetailPage() {
	const { t } = useTranslation()
	const { embedId } = Route.useParams()
	const { colorTab = "light" } = Route.useSearch()
	const navigate = Route.useNavigate()
	const queryClient = useQueryClient()
	const { data: embedResponse, isLoading, isError } = useGetEmbed(embedId)
	const embed = embedResponse?.data.embed
	const { data: agentsResponse } = useListAgents()
	const agents = agentsResponse?.data.agents
	const agentOptions = agents?.map((agent) => ({ value: agent.id, label: agent.name })) ?? []
	const permissions = useGetMyPermissions().data?.data.permissions
	const canManage = permissions?.includes("agents:manage") ?? false
	const updateEmbed = useUpdateEmbed({
		mutation: {
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: getGetEmbedQueryKey(embedId) })
				await queryClient.invalidateQueries({ queryKey: getListEmbedsQueryKey() })
			},
		},
	})
	const [copied, setCopied] = useState(false)
	const copyTimeout = useRef<number | undefined>(undefined)

	const { register, handleSubmit, reset, control, formState } = useForm<EmbedFormValues>({
		resolver: zodResolver(embedFormSchema),
		// `values` lands one render after mount; without defaults the selects mount uncontrolled.
		defaultValues: { name: "", agentId: "", ...EMBED_FORM_DEFAULTS },
		// keepDirtyValues so a background refetch never discards the operator's typing.
		values: embed ? toFormValues(embed) : undefined,
		resetOptions: { keepDirtyValues: true },
	})

	useEffect(() => {
		return () => window.clearTimeout(copyTimeout.current)
	}, [])

	// Follows the form, not the server, so the preview updates before a save.
	const { appearance, name } = useWatch({
		control,
		compute: (values) => ({ appearance: toAppearance(values), name: values.name }),
	})

	// Base UI shows the raw value in a closed trigger unless `items` maps it to a label.
	const positionOptions = WIDGET_POSITIONS.map((value) => ({ value, label: positionLabel(value, t) }))
	const themeOptions = WIDGET_THEMES.map((value) => ({ value, label: themeLabel(value, t) }))
	const languageOptions = Object.entries(supportedLanguages).map(([value, label]) => ({ value, label }))

	const scriptUrl = import.meta.env.VITE_WIDGET_CDN_URL as string | undefined
	const snippet =
		scriptUrl && embed
			? buildEmbedSnippet(scriptUrl, {
					embedToken: embed.embedToken,
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

	function onValid(submitted: EmbedFormValues) {
		updateEmbed.mutate(
			{
				embedId,
				data: {
					name: submitted.name.trim(),
					agentId: submitted.agentId,
					appearance: toAppearance(submitted),
				},
			},
			// Re-sync on save so the stored values show through and the fields go clean.
			{ onSuccess: (saved) => reset(toFormValues(saved.data.embed)) },
		)
	}

	if (isLoading) {
		return <p className="text-muted-foreground">{t("embedSetup.loading")}</p>
	}
	if (isError || !embed) {
		return <p className="text-muted-foreground">{t("embedSetup.notFound")}</p>
	}

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<Button
				render={<Link to="/dashboard/agent/$agentId" params={{ agentId: embed.agentId }} search={{ tab: "embeds" }} />}
				nativeButton={false}
				variant="ghost"
				className="-ml-2"
			>
				<ArrowLeft className="size-4" />
				{t("embedSetup.backToAgent")}
			</Button>

			<PageHeader title={embed.name} description={t("embedSetup.detailSubheading")} />

			<Card>
				<CardHeader>
					<CardTitle>{t("embedSetup.embedCode")}</CardTitle>
					<CardDescription>{t("embedSetup.embedDescription")}</CardDescription>
				</CardHeader>
				<CardContent>
					{snippet ? (
						<div className="relative">
							<pre className="bg-muted rounded-surface overflow-x-auto border p-4 font-mono text-sm">{snippet}</pre>
							<Button
								variant="outline"
								size="icon"
								className="absolute top-2 right-2"
								onClick={copySnippet}
								aria-label={t("embedSetup.copyEmbed")}
							>
								{copied ? <Check className="text-primary size-4" /> : <Copy className="size-4" />}
							</Button>
						</div>
					) : (
						<p className="text-muted-foreground">{t("embedSetup.scriptUrlMissing")}</p>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("embedSetup.embedToken")}</CardTitle>
					<CardDescription>{t("embedSetup.embedTokenDescription")}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<Input value={embed.embedToken} readOnly className="font-mono" aria-label={t("embedSetup.embedToken")} />
					{canManage && <RotateEmbedTokenDialog embedId={embedId} />}
				</CardContent>
			</Card>

			<div className="grid items-start gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>{t("embedSetup.appearance")}</CardTitle>
						<CardDescription>{t("embedSetup.appearanceDescription")}</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit(onValid)} className="space-y-4">
							{/* Native cascade: one attribute disables every control below, including the
							    Base UI triggers, so a read-only operator reads the widget without editing it. */}
							<fieldset disabled={!canManage} className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="widget-name">{t("embedSetup.nameLabel")}</Label>
									<Input
										id="widget-name"
										aria-invalid={formState.errors.name ? true : undefined}
										{...register("name")}
									/>
								</div>

								<div className="space-y-2">
									<Label htmlFor="widget-agent">{t("embedSetup.agentLabel")}</Label>
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
													<SelectValue placeholder={t("embedSetup.selectAgent")} />
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
									<p className="text-muted-foreground text-xs">{t("embedSetup.agentHelp")}</p>
								</div>

								<p className="text-muted-foreground text-xs">{t("embedSetup.colorsHelp")}</p>
								<Tabs
									value={colorTab}
									onValueChange={(value) => {
										if (isColorSchemeTab(value)) {
											void navigate({
												search: (prev) => ({ ...prev, colorTab: value }),
												replace: true,
												resetScroll: false,
											})
										}
									}}
								>
									<TabsList>
										<TabsTrigger value="light">{t("embedSetup.tabLight")}</TabsTrigger>
										<TabsTrigger value="dark">{t("embedSetup.tabDark")}</TabsTrigger>
									</TabsList>
									<TabsContent value="light">
										<SchemeColorFields scheme="light" control={control} appearanceScheme={appearance.light} t={t} />
									</TabsContent>
									<TabsContent value="dark">
										<SchemeColorFields scheme="dark" control={control} appearanceScheme={appearance.dark} t={t} />
									</TabsContent>
								</Tabs>

								<div className="space-y-2">
									<Label htmlFor="widget-position">{t("embedSetup.position")}</Label>
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
									<Label htmlFor="widget-theme">{t("embedSetup.theme")}</Label>
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
									<Label htmlFor="widget-theme-toggle">{t("embedSetup.themeToggle")}</Label>
								</div>

								<div className="space-y-2">
									<Label htmlFor="widget-language">{t("embedSetup.language")}</Label>
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

							{updateEmbed.isError && (
								<p role="alert" className="text-destructive text-sm">
									{t("embedSetup.saveError")}
								</p>
							)}
							{canManage && (
								<div className="flex items-center gap-3 pt-2">
									<Button type="submit" disabled={updateEmbed.isPending}>
										{updateEmbed.isPending ? t("embedSetup.saving") : t("embedSetup.save")}
									</Button>
									{/* `isSuccess` never clears on its own; the save resets the form, so a new edit drops it. */}
									{updateEmbed.isSuccess && !updateEmbed.isPending && !formState.isDirty && (
										<span className="text-muted-foreground text-sm">{t("embedSetup.saved")}</span>
									)}
								</div>
							)}
						</form>
					</CardContent>
				</Card>

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
								<WidgetPreview appearance={appearance} title={name} activeScheme={colorTab} previewKey={embedId} />
							</div>
						</div>
					</CardContent>
				</Card>
			</div>

			{canManage && (
				<Card className="ring-destructive">
					<CardHeader>
						<CardTitle>{t("embedSetup.dangerZone")}</CardTitle>
						<CardDescription>{t("embedSetup.dangerDescription")}</CardDescription>
					</CardHeader>
					<CardContent>
						<DeleteEmbedDialog embed={embed} />
					</CardContent>
				</Card>
			)}
		</div>
	)
}
