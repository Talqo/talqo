import type {
	AiProviderAuthMode,
	AiProviderId,
	ProviderMetadata,
	RedactedRoleConfiguration,
	RoleConfigurationInput,
} from "@/api/client.ts"
import type { AiConfigurationFormValues } from "@/features/ai-configuration/ai-configuration-form"
import type { DiscoveryContext } from "@/features/ai-configuration/discovery-readiness.ts"

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
	useSaveAiProviderConfiguration,
} from "@/features/ai-configuration/ai-configuration-query"
import { storedCredentialsMatch } from "@/features/ai-configuration/discovery-readiness.ts"
import { ModelAutocomplete } from "@/features/ai-configuration/model-autocomplete"
import { ProviderBrand } from "@/features/ai-configuration/provider-brand"
import { useModelDiscovery } from "@/features/ai-configuration/use-model-discovery"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Tabs, TabsList, TabsTrigger } from "@talqo/ui/components/tabs"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
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

function ProviderSelect({
	id,
	providers,
	value,
	onChange,
	disabled = false,
}: {
	id: string
	providers: ProviderMetadata[]
	value: AiProviderId
	onChange: (providerId: AiProviderId) => void
	disabled?: boolean
}) {
	const { t } = useTranslation()
	return (
		<Select value={value} onValueChange={(next) => onChange(next as AiProviderId)} disabled={disabled}>
			<SelectTrigger id={id} className="w-full">
				<SelectValue>
					{(providerId: AiProviderId) => {
						const provider = providers.find((item) => item.id === providerId)
						if (!provider) return null
						return (
							<span className="flex items-center gap-2">
								<ProviderBrand providerId={provider.id} />
								{providerLabel(provider.id, t)}
							</span>
						)
					}}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{providers.map((item) => (
					<SelectItem key={item.id} value={item.id}>
						<span className="flex items-center gap-2">
							<ProviderBrand providerId={item.id} />
							{providerLabel(item.id, t)}
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

function ModelField({
	role,
	label,
	modelId,
	onModelChange,
	provider,
	value,
	stored,
	storedCredentialRole,
	disabled = false,
}: {
	role: "text" | "embedding"
	label: string
	modelId: string
	onModelChange: (modelId: string) => void
	provider: ProviderMetadata
	value: Pick<RoleValue, "authMode" | "settings" | "credentials">
	stored: RedactedRoleConfiguration | null
	storedCredentialRole: "text" | "embedding"
	disabled?: boolean
}) {
	const { t } = useTranslation()
	const context: DiscoveryContext = { provider, value, stored }
	const discovery = useModelDiscovery({ ...context, storedCredentialRole })
	const refreshWithStoredCredentials = storedCredentialsMatch(context)
	return (
		<div className="space-y-2">
			<Label htmlFor={`${role}-model`}>{label}</Label>
			<ModelAutocomplete
				id={`${role}-model`}
				value={modelId}
				onChange={onModelChange}
				models={discovery.models}
				loading={discovery.loading}
				disabled={disabled}
				emptyLabel={t("aiConfiguration.discovery.noResults")}
				triggerLabel={t("aiConfiguration.discovery.showModels")}
			/>
			{discovery.failed && (
				<p className="text-muted-foreground text-xs">
					{refreshWithStoredCredentials
						? t("aiConfiguration.discovery.unavailableStored")
						: t("aiConfiguration.discovery.unavailable")}{" "}
					<button type="button" className="text-foreground underline underline-offset-2" onClick={discovery.retry}>
						{t("aiConfiguration.discovery.retry")}
					</button>
				</p>
			)}
		</div>
	)
}

function ConnectionFields({
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
	if (!provider) return null

	function selectProvider(providerId: AiProviderId) {
		const next = providers.find((item) => item.id === providerId)
		if (!next) return
		onChange({ providerId, modelId: "", authMode: next.authModes[0] ?? "static", settings: {}, credentials: {} })
	}

	return (
		<>
			<div className="space-y-2">
				<Label htmlFor={`${role}-provider`}>{t("aiConfiguration.fields.provider")}</Label>
				<ProviderSelect
					id={`${role}-provider`}
					providers={providers}
					value={value.providerId}
					onChange={selectProvider}
					disabled={disabled}
				/>
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
		</>
	)
}

function RoleFields(props: {
	role: "text" | "embedding"
	value: RoleValue
	onChange: (value: RoleValue) => void
	providers: ProviderMetadata[]
	stored: RedactedRoleConfiguration | null
	disabled?: boolean
}) {
	const { t } = useTranslation()
	const { role, value, onChange, providers, stored, disabled = false } = props
	const provider = providers.find(({ id }) => id === value.providerId) ?? providers[0]
	if (!provider) return null

	return (
		<div className="space-y-4">
			<ConnectionFields {...props} />
			<ModelField
				role={role}
				label={role === "text" ? t("aiConfiguration.fields.textModel") : t("aiConfiguration.fields.embeddingModel")}
				modelId={value.modelId}
				onModelChange={(modelId) => onChange({ ...value, modelId })}
				provider={provider}
				value={value}
				stored={stored}
				storedCredentialRole={role}
				disabled={disabled}
			/>
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

	const watchedTextRole = useWatch({ control, name: "text" })

	if (providersQuery.isLoading || configurationQuery.isLoading)
		return <p className="text-muted-foreground">{t("aiConfiguration.loading")}</p>
	if (!providersQuery.data || !configurationQuery.data)
		return (
			<p role="alert" className="text-destructive">
				{t("aiConfiguration.loadError")}
			</p>
		)

	const configuration = configurationQuery.data
	const providers = providersQuery.data.providers
	const embeddingProviders = providers.filter((provider) => provider.roles.includes("embedding"))

	async function onValid(values: AiConfigurationFormValues) {
		setSaved(false)
		await save.mutateAsync(buildSaveInput(values))
		setSaved(true)
	}

	function onTextChange(next: RoleValue) {
		const embedding = getValues("embedding")
		if (embedding.credentialSource !== "text") return
		const nextProvider = providers.find((provider) => provider.id === next.providerId)
		if (nextProvider?.roles.includes("embedding")) {
			setValue("embedding", {
				...embedding,
				providerId: next.providerId,
				authMode: next.authMode,
				settings: next.settings,
				credentials: next.credentials,
			})
			return
		}
		const fallback = embeddingProviders.find((provider) => provider.id !== next.providerId) ?? embeddingProviders[0]
		if (!fallback) return
		setValue("embedding", {
			providerId: fallback.id,
			modelId: embedding.modelId,
			authMode: fallback.authModes[0] ?? "static",
			settings: {},
			credentials: {},
			credentialSource: "separate",
		})
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<PageHeader title={t("aiConfiguration.heading")} description={t("aiConfiguration.subheading")} />
			{configuration.health === "unusable" && (
				<p
					role="alert"
					className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
				>
					{t("aiConfiguration.unusableWarning")}
				</p>
			)}
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
										onTextChange(next)
									}}
									providers={providers}
									stored={configuration.text}
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
					<CardContent>
						<Controller
							control={control}
							name="embedding"
							render={({ field }) => {
								const textRole = watchedTextRole
								const textProvider = providers.find((provider) => provider.id === textRole.providerId)
								const canReuse = textProvider?.roles.includes("embedding") ?? false
								const sameProvider = field.value.credentialSource === "text"
								return (
									<div className="space-y-4">
										<Tabs
											value={sameProvider ? "same" : "different"}
											onValueChange={(next) => {
												if (next === "same") {
													if (!textProvider) return
													field.onChange({
														...field.value,
														providerId: textRole.providerId,
														authMode: textRole.authMode,
														settings: textRole.settings,
														credentials: textRole.credentials,
														credentialSource: "text",
													})
													return
												}
												if (sameProvider) {
													field.onChange({
														...field.value,
														settings: {},
														credentials: {},
														credentialSource: "separate",
													})
													return
												}
												field.onChange({
													...field.value,
													credentialSource:
														field.value.authMode === "deployment-identity" ? "deployment-identity" : "separate",
												})
											}}
										>
											<TabsList>
												<TabsTrigger value="same" disabled={!canReuse}>
													{t("aiConfiguration.tabs.sameProvider")}
												</TabsTrigger>
												<TabsTrigger value="different">{t("aiConfiguration.tabs.differentProvider")}</TabsTrigger>
											</TabsList>
										</Tabs>
										{!canReuse && (
											<p className="text-muted-foreground text-xs">{t("aiConfiguration.sameProviderUnavailable")}</p>
										)}
										{sameProvider && textProvider ? (
											<div className="space-y-4">
												<p className="text-muted-foreground flex items-center gap-2 text-sm">
													<ProviderBrand providerId={textProvider.id} />
													{t("aiConfiguration.sameProviderNote")}
												</p>
												<ModelField
													role="embedding"
													label={t("aiConfiguration.fields.embeddingModel")}
													modelId={field.value.modelId}
													onModelChange={(modelId) => field.onChange({ ...field.value, modelId })}
													provider={textProvider}
													value={textRole}
													stored={configuration.text}
													storedCredentialRole="text"
												/>
											</div>
										) : (
											<RoleFields
												role="embedding"
												value={field.value}
												onChange={field.onChange}
												providers={embeddingProviders}
												stored={configuration.embedding}
											/>
										)}
									</div>
								)
							}}
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
