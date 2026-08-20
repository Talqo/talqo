import type {
	AiProviderAuthMode,
	AiProviderId,
	ProviderMetadata,
	RedactedRoleConfiguration,
	RoleConfigurationInput,
} from "@/api/client.ts"
import type { AiConfigurationFormValues } from "@/features/ai-configuration/ai-configuration-form"

import { getAccess } from "@/api/client.ts"
import { PageHeader } from "@/components/page-header"
import {
	aiConfigurationFormSchema,
	buildSaveInput,
	configurationToFormValues,
} from "@/features/ai-configuration/ai-configuration-form"
import {
	useAiProviderConfiguration,
	useAiProviders,
	useDiscoverAiProviderModels,
	useSaveAiProviderConfiguration,
} from "@/features/ai-configuration/ai-configuration-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Switch } from "@talqo/ui/components/switch"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useEffect, useId, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/ai-configuration")({
	beforeLoad: async () => {
		let access
		try {
			access = await getAccess()
		} catch {
			throw redirect({ to: "/login" })
		}
		if (!access.permissions.includes("ai_provider:manage")) throw redirect({ to: "/dashboard" })
	},
	component: AiConfigurationPage,
})

type RoleValue = RoleConfigurationInput & { credentials: Record<string, string> }

function providerLabel(providerId: AiProviderId, t: (key: string) => string): string {
	switch (providerId) {
		case "openai":
			return t("aiConfiguration.providers.openai")
		case "anthropic":
			return t("aiConfiguration.providers.anthropic")
		case "google":
			return t("aiConfiguration.providers.google")
		case "mistral":
			return t("aiConfiguration.providers.mistral")
		case "azure":
			return t("aiConfiguration.providers.azure")
		case "amazon-bedrock":
			return t("aiConfiguration.providers.amazonBedrock")
		case "openai-compatible":
			return t("aiConfiguration.providers.openaiCompatible")
	}
}

function fieldLabel(field: string, t: (key: string) => string): string {
	switch (field) {
		case "apiKey":
			return t("aiConfiguration.fields.apiKey")
		case "accessKeyId":
			return t("aiConfiguration.fields.accessKeyId")
		case "secretAccessKey":
			return t("aiConfiguration.fields.secretAccessKey")
		case "sessionToken":
			return t("aiConfiguration.fields.sessionToken")
		case "baseURL":
			return t("aiConfiguration.fields.baseURL")
		case "project":
			return t("aiConfiguration.fields.project")
		case "apiVersion":
			return t("aiConfiguration.fields.apiVersion")
		case "region":
			return t("aiConfiguration.fields.region")
		default:
			return field
	}
}

function authModeLabel(mode: AiProviderAuthMode, t: (key: string) => string): string {
	return mode === "static" ? t("aiConfiguration.auth.static") : t("aiConfiguration.auth.deploymentIdentity")
}

function RoleFields({
	role,
	value,
	onChange,
	providers,
	stored,
	disabled = false,
}: {
	role: "text" | "embedding"
	value: RoleValue
	onChange: (value: RoleValue) => void
	providers: ProviderMetadata[]
	stored: RedactedRoleConfiguration | null
	disabled?: boolean
}) {
	const { t } = useTranslation()
	const provider = providers.find(({ id }) => id === value.providerId) ?? providers[0]
	const discover = useDiscoverAiProviderModels()
	const [models, setModels] = useState<string[] | null>(null)
	const [manual, setManual] = useState(false)
	const listId = useId()

	if (!provider) return null

	async function loadModels() {
		setManual(false)
		try {
			const credentials = Object.fromEntries(Object.entries(value.credentials).filter(([, item]) => item.trim()))
			const result = await discover.mutateAsync({
				providerId: value.providerId,
				authMode: value.authMode,
				settings: value.settings,
				credentials: Object.keys(credentials).length ? credentials : undefined,
				storedCredentialRole: Object.keys(credentials).length ? undefined : role,
			})
			setModels(result.models)
			if (result.models.length === 0) setManual(true)
		} catch {
			setModels(null)
			setManual(true)
		}
	}

	function selectProvider(providerId: AiProviderId) {
		const next = providers.find((item) => item.id === providerId)
		if (!next) return
		setModels(null)
		setManual(false)
		onChange({ providerId, modelId: "", authMode: next.authModes[0] ?? "static", settings: {}, credentials: {} })
	}

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor={`${role}-provider`}>{t("aiConfiguration.fields.provider")}</Label>
				<Select
					value={value.providerId}
					onValueChange={(next) => selectProvider(next as AiProviderId)}
					disabled={disabled}
				>
					<SelectTrigger id={`${role}-provider`} className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{providers.map((item) => (
							<SelectItem key={item.id} value={item.id}>
								{providerLabel(item.id, t)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{provider.authModes.length > 1 && (
				<div className="space-y-2">
					<Label htmlFor={`${role}-authentication`}>{t("aiConfiguration.fields.authentication")}</Label>
					<Select
						value={value.authMode}
						onValueChange={(mode) => onChange({ ...value, authMode: mode as AiProviderAuthMode, credentials: {} })}
						disabled={disabled}
					>
						<SelectTrigger id={`${role}-authentication`} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{provider.authModes.map((mode) => (
								<SelectItem key={mode} value={mode}>
									{authModeLabel(mode, t)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			{provider.settingFields.map((field) => (
				<div className="space-y-2" key={field}>
					<Label htmlFor={`${role}-${field}`}>{fieldLabel(field, t)}</Label>
					<Input
						id={`${role}-${field}`}
						value={value.settings[field] ?? ""}
						disabled={disabled}
						onChange={(event) => onChange({ ...value, settings: { ...value.settings, [field]: event.target.value } })}
					/>
				</div>
			))}

			{value.authMode === "static" &&
				!disabled &&
				provider.credentialFields.map((field) => (
					<div className="space-y-2" key={field}>
						<Label htmlFor={`${role}-${field}`}>{fieldLabel(field, t)}</Label>
						<Input
							id={`${role}-${field}`}
							type="password"
							autoComplete="off"
							placeholder={stored?.hasCredentials ? t("aiConfiguration.configured") : undefined}
							value={value.credentials[field] ?? ""}
							onChange={(event) =>
								onChange({ ...value, credentials: { ...value.credentials, [field]: event.target.value } })
							}
						/>
					</div>
				))}

			<div className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<Label htmlFor={`${role}-model`}>
						{role === "text" ? t("aiConfiguration.fields.textModel") : t("aiConfiguration.fields.embeddingModel")}
					</Label>
					<Button type="button" variant="outline" size="sm" onClick={loadModels} disabled={discover.isPending}>
						{discover.isPending ? t("aiConfiguration.loadingModels") : t("aiConfiguration.loadModels")}
					</Button>
				</div>
				<Input
					id={`${role}-model`}
					list={models && models.length ? listId : undefined}
					readOnly={!manual && models === null && !value.modelId}
					value={value.modelId}
					onChange={(event) => onChange({ ...value, modelId: event.target.value })}
					placeholder={manual ? t("aiConfiguration.fields.manualModel") : undefined}
				/>
				{models && (
					<datalist id={listId}>
						{models.map((model) => (
							<option key={model} value={model} />
						))}
					</datalist>
				)}
				{manual && <p className="text-muted-foreground text-xs">{t("aiConfiguration.manualModelHelp")}</p>}
				{discover.isError && (
					<p role="alert" className="text-destructive text-xs">
						{discover.error.message}
					</p>
				)}
			</div>
		</div>
	)
}

function AiConfigurationPage() {
	const { t } = useTranslation()
	const providersQuery = useAiProviders()
	const configurationQuery = useAiProviderConfiguration()
	const save = useSaveAiProviderConfiguration()
	const [saved, setSaved] = useState(false)
	const {
		control,
		handleSubmit,
		reset,
		setValue,
		getValues,
		formState: { errors },
	} = useForm<AiConfigurationFormValues>({
		resolver: zodResolver(aiConfigurationFormSchema),
		defaultValues: configurationToFormValues({ revision: 0, health: "unconfigured", text: null, embedding: null }),
	})

	useEffect(() => {
		if (configurationQuery.data) reset(configurationToFormValues(configurationQuery.data))
	}, [configurationQuery.data, reset])

	if (providersQuery.isLoading || configurationQuery.isLoading)
		return <p className="text-muted-foreground">{t("aiConfiguration.loading")}</p>
	if (!providersQuery.data || !configurationQuery.data)
		return (
			<p role="alert" className="text-destructive">
				{t("aiConfiguration.loadError")}
			</p>
		)

	const providers = providersQuery.data.providers
	const embeddingProviders = providers.filter((provider) => provider.roles.includes("embedding"))

	async function onValid(values: AiConfigurationFormValues) {
		setSaved(false)
		await save.mutateAsync(buildSaveInput(values))
		setSaved(true)
	}

	function syncText(next: RoleValue) {
		const embedding = getValues("embedding")
		if (embedding.credentialSource === "text") {
			const supportsEmbedding = embeddingProviders.some(({ id }) => id === next.providerId)
			if (supportsEmbedding) {
				setValue("embedding", {
					...embedding,
					providerId: next.providerId,
					authMode: next.authMode,
					settings: next.settings,
					credentials: next.credentials,
				})
			} else {
				setValue("embedding.credentialSource", "separate")
			}
		}
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<PageHeader title={t("aiConfiguration.heading")} description={t("aiConfiguration.subheading")} />
			<form onSubmit={handleSubmit(onValid)} className="space-y-6">
				<Card>
					<CardHeader>
						<CardTitle>{t("aiConfiguration.textTitle")}</CardTitle>
						<CardDescription>{t("aiConfiguration.textDescription")}</CardDescription>
					</CardHeader>
					<CardContent>
						<Controller
							control={control}
							name="text"
							render={({ field }) => (
								<RoleFields
									role="text"
									value={field.value}
									onChange={(next) => {
										field.onChange(next)
										syncText(next)
									}}
									providers={providers}
									stored={configurationQuery.data.text}
								/>
							)}
						/>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>{t("aiConfiguration.embeddingTitle")}</CardTitle>
						<CardDescription>{t("aiConfiguration.embeddingDescription")}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<Controller
							control={control}
							name="embedding"
							render={({ field }) => (
								<>
									<div className="flex items-center gap-2">
										<Switch
											id="reuse-text-credentials"
											checked={field.value.credentialSource === "text"}
											onCheckedChange={(checked) => {
												const text = getValues("text")
												field.onChange(
													checked
														? {
																...field.value,
																providerId: text.providerId,
																authMode: text.authMode,
																settings: text.settings,
																credentials: text.credentials,
																credentialSource: "text",
															}
														: {
																...field.value,
																credentialSource:
																	field.value.authMode === "deployment-identity" ? "deployment-identity" : "separate",
															},
												)
											}}
										/>
										<Label htmlFor="reuse-text-credentials">{t("aiConfiguration.reuseCredentials")}</Label>
									</div>
									<RoleFields
										role="embedding"
										value={field.value}
										onChange={(next) => field.onChange({ ...field.value, ...next })}
										providers={embeddingProviders}
										stored={configurationQuery.data.embedding}
										disabled={field.value.credentialSource === "text"}
									/>
								</>
							)}
						/>
					</CardContent>
				</Card>

				{Object.keys(errors).length > 0 && (
					<p role="alert" className="text-destructive text-sm">
						{t("aiConfiguration.validationError")}
					</p>
				)}
				{save.isError && (
					<p role="alert" className="text-destructive text-sm">
						{save.error.message}
					</p>
				)}
				<div className="flex items-center gap-3">
					<Button type="submit" disabled={save.isPending}>
						{save.isPending ? t("aiConfiguration.saving") : t("aiConfiguration.save")}
					</Button>
					{saved && <output className="text-muted-foreground text-sm">{t("aiConfiguration.saved")}</output>}
				</div>
			</form>
		</div>
	)
}
