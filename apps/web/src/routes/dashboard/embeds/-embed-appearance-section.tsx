import type { Embed } from "@/api/generated/models/embed.zod"

import { getGetEmbedQueryKey, getListEmbedsQueryKey, useUpdateEmbed } from "@/api/generated/embed/embed.ts"
import {
	EMBED_FORM_DEFAULTS,
	embedFormSchema,
	type EmbedFormValues,
	toAppearance,
	toFormValues,
} from "@/features/embeds/embed-appearance-form"
import { useDirtyFormGuard } from "@/lib/use-dirty-form-guard"
import { zodResolver } from "@hookform/resolvers/zod"
import { isSupportedLanguage, supportedLanguages } from "@talqo/shared/languages"
import { isWidgetPosition, isWidgetTheme, WIDGET_POSITIONS, WIDGET_THEMES } from "@talqo/shared/widget-appearance"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { FormActions } from "@talqo/ui/components/form-actions"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Switch } from "@talqo/ui/components/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@talqo/ui/components/tabs"
import { useQueryClient } from "@tanstack/react-query"
import { type Control, Controller, useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { ColorField } from "./-color-field"
import { EmbedPreviewCard } from "./-embed-preview-card"

export type ColorSchemeTab = "light" | "dark"

function positionLabel(position: (typeof WIDGET_POSITIONS)[number], t: (key: string) => string): string {
	return position === "bottom-right" ? t("embedSetup.positionBottomRight") : t("embedSetup.positionBottomLeft")
}

const themeLabels = {
	light: "embedSetup.themeLight",
	dark: "embedSetup.themeDark",
	system: "embedSetup.themeSystem",
} as const satisfies Record<(typeof WIDGET_THEMES)[number], string>

function SchemeColorFields({
	scheme,
	control,
	appearanceScheme,
	readOnly,
	t,
}: {
	scheme: ColorSchemeTab
	control: Control<EmbedFormValues>
	appearanceScheme: { primary: string; textOnPrimary: string; background: string; surface: string; text: string }
	readOnly: boolean
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
						readOnly={readOnly}
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
						readOnly={readOnly}
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
						readOnly={readOnly}
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
						readOnly={readOnly}
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
						readOnly={readOnly}
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

type EmbedAppearanceSectionProps = {
	canManage: boolean
	colorTab: ColorSchemeTab
	embed: Embed
	embedId: string
	onColorTabChange: (value: string) => void
}

export function EmbedAppearanceSection({
	canManage,
	colorTab,
	embed,
	embedId,
	onColorTabChange,
}: EmbedAppearanceSectionProps) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const updateEmbed = useUpdateEmbed({
		mutation: {
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: getGetEmbedQueryKey(embedId) })
				await queryClient.invalidateQueries({ queryKey: getListEmbedsQueryKey() })
			},
		},
	})

	const { register, handleSubmit, reset, control, setFocus, formState } = useForm<EmbedFormValues>({
		resolver: zodResolver(embedFormSchema),
		// `values` lands one render after mount; without defaults the selects mount uncontrolled.
		defaultValues: { name: "", ...EMBED_FORM_DEFAULTS },
		// keepDirtyValues so a background refetch never discards the operator's typing.
		values: toFormValues(embed),
		resetOptions: { keepDirtyValues: true },
	})
	const dirtyGuard = useDirtyFormGuard(formState.isDirty)

	// Follows the form, not the server, so the preview updates before a save.
	const { appearance, name } = useWatch({
		control,
		compute: (values) => ({ appearance: toAppearance(values), name: values.name }),
	})

	// Base UI shows the raw value in a closed trigger unless `items` maps it to a label.
	const positionOptions = WIDGET_POSITIONS.map((value) => ({ value, label: positionLabel(value, t) }))
	const themeOptions = WIDGET_THEMES.map((value) => ({ value, label: t(themeLabels[value]) }))
	const languageOptions = Object.entries(supportedLanguages).map(([value, label]) => ({ value, label }))

	function onValid(submitted: EmbedFormValues) {
		if (!canManage) return
		updateEmbed.mutate(
			{
				embedId,
				// The agent selector is gone from the form; the update contract still requires it.
				data: {
					name: submitted.name.trim(),
					agentId: embed.agentId,
					appearance: toAppearance(submitted),
				},
			},
			// Re-sync on save so the stored values show through and the fields go clean.
			{ onSuccess: (saved) => reset(toFormValues(saved.data.embed), { keepDirtyValues: false }) },
		)
	}

	return (
		<>
			{dirtyGuard}
			<div className="grid items-start gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle level={2}>{t("embedSetup.appearance")}</CardTitle>
						<CardDescription>{t("embedSetup.appearanceDescription")}</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit(onValid, () => setFocus("name"))} className="space-y-4">
							<fieldset className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="widget-name">{t("embedSetup.nameLabel")}</Label>
									<Input
										id="widget-name"
										readOnly={!canManage}
										aria-invalid={formState.errors.name ? true : undefined}
										aria-describedby={formState.errors.name ? "widget-name-error" : undefined}
										{...register("name")}
									/>
									{formState.errors.name && (
										<p id="widget-name-error" className="text-destructive text-xs" role="alert">
											{t("embedSetup.nameRequired")}
										</p>
									)}
								</div>

								<p className="text-muted-foreground text-xs">{t("embedSetup.colorsHelp")}</p>
								<Tabs value={colorTab} onValueChange={onColorTabChange}>
									<TabsList>
										<TabsTrigger value="light">{t("embedSetup.tabLight")}</TabsTrigger>
										<TabsTrigger value="dark">{t("embedSetup.tabDark")}</TabsTrigger>
									</TabsList>
									<TabsContent value="light">
										<SchemeColorFields
											scheme="light"
											control={control}
											appearanceScheme={appearance.light}
											readOnly={!canManage}
											t={t}
										/>
									</TabsContent>
									<TabsContent value="dark">
										<SchemeColorFields
											scheme="dark"
											control={control}
											appearanceScheme={appearance.dark}
											readOnly={!canManage}
											t={t}
										/>
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
												disabled={!canManage}
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
												disabled={!canManage}
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
											<Switch
												id="widget-theme-toggle"
												disabled={!canManage}
												checked={field.value}
												onCheckedChange={field.onChange}
											/>
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
												disabled={!canManage}
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
								<FormActions status={updateEmbed.isSuccess && !formState.isDirty ? t("embedSetup.saved") : undefined}>
									<Button type="submit" disabled={updateEmbed.isPending || !formState.isDirty}>
										{updateEmbed.isPending ? t("embedSetup.saving") : t("embedSetup.save")}
									</Button>
								</FormActions>
							)}
						</form>
					</CardContent>
				</Card>

				<EmbedPreviewCard appearance={appearance} title={name} activeScheme={colorTab} embedId={embedId} />
			</div>
		</>
	)
}
