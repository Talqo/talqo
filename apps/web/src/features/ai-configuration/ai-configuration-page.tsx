import type { AiConfigurationFormValues } from "@/features/ai-configuration/ai-configuration-form"
import type { DiscoveryContext } from "@/features/ai-configuration/discovery-readiness.ts"
import type {
	AiProviderAuthMode,
	AiProviderId,
	ProviderMetadata,
	RedactedRoleConfiguration,
	RoleConfigurationInput,
} from "@/features/ai-configuration/types.ts"

import {
	useGetAiProviderConfiguration,
	useListAiProviders,
	useSaveAiProviderConfiguration,
} from "@/api/generated/ai-providers/ai-providers.ts"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import {
	aiConfigurationFormSchema,
	buildSaveInput,
	configurationToFormValues,
} from "@/features/ai-configuration/ai-configuration-form"
import { storedCredentialsMatch } from "@/features/ai-configuration/discovery-readiness.ts"
import { ModelAutocomplete } from "@/features/ai-configuration/model-autocomplete"
import { ProviderBrand } from "@/features/ai-configuration/provider-brand"
import { useModelDiscovery } from "@/features/ai-configuration/use-model-discovery"
import { getProblemMessage } from "@/lib/problem-message.ts"
import { useDirtyFormGuard } from "@/lib/use-dirty-form-guard"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@talqo/ui/components/dialog"
import { FormActions } from "@talqo/ui/components/form-actions"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@talqo/ui/components/tabs"
import { LockIcon, PencilLineIcon } from "lucide-react"
import { type RefObject, useEffect, useMemo, useRef, useState } from "react"
import { Controller, type FieldErrors, useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

type RoleValue = RoleConfigurationInput & { credentials: Record<string, string> }

function settingsKey(settings: Record<string, string>): string {
	return JSON.stringify(Object.entries(settings).toSorted(([a], [b]) => a.localeCompare(b)))
}

const providerLabels = {
	openai: "aiConfiguration.providers.openai",
	anthropic: "aiConfiguration.providers.anthropic",
	google: "aiConfiguration.providers.google",
	mistral: "aiConfiguration.providers.mistral",
	azure: "aiConfiguration.providers.azure",
	"amazon-bedrock": "aiConfiguration.providers.amazonBedrock",
	"openai-compatible": "aiConfiguration.providers.openaiCompatible",
} as const satisfies Record<AiProviderId, string>

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

function focusFirstInvalidModel(errors: FieldErrors<AiConfigurationFormValues>): void {
	document.getElementById(errors.text?.modelId ? "text-model" : "embedding-model")?.focus()
}

function RequiredMark() {
	return (
		<span aria-hidden="true" className="text-muted-foreground">
			*
		</span>
	)
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
		<Select<AiProviderId>
			value={value}
			onValueChange={(next) => {
				if (next === null) return
				onChange(next)
			}}
			disabled={disabled}
		>
			<SelectTrigger id={id} className="w-full" aria-required="true">
				<SelectValue>
					{(providerId: AiProviderId) => {
						const provider = providers.find((item) => item.id === providerId)
						if (!provider) return null
						return (
							<span className="flex items-center gap-2">
								<ProviderBrand providerId={provider.id} />
								{t(providerLabels[provider.id])}
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
							{t(providerLabels[item.id])}
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

function ModelField({
	modelRole: role,
	label,
	modelId,
	onModelChange,
	provider,
	value,
	stored,
	storedCredentialRole,
	disabled = false,
	invalid = false,
}: {
	modelRole: "text" | "embedding"
	label: string
	modelId: string
	onModelChange: (modelId: string) => void
	provider: ProviderMetadata
	value: Pick<RoleValue, "authMode" | "settings" | "credentials">
	stored: RedactedRoleConfiguration | null
	storedCredentialRole: "text" | "embedding"
	disabled?: boolean
	invalid?: boolean
}) {
	const { t } = useTranslation()
	const context: DiscoveryContext = { provider, value, stored }
	const discovery = useModelDiscovery({ ...context, storedCredentialRole })
	const refreshWithStoredCredentials = storedCredentialsMatch(context)
	const errorId = `${role}-model-error`
	return (
		<div className="space-y-2">
			<Label htmlFor={`${role}-model`}>
				{label} <RequiredMark />
			</Label>
			<ModelAutocomplete
				id={`${role}-model`}
				value={modelId}
				onChange={onModelChange}
				models={discovery.models}
				loading={discovery.loading}
				disabled={disabled}
				required={!disabled}
				invalid={invalid}
				describedBy={invalid ? errorId : undefined}
				emptyLabel={t("aiConfiguration.discovery.noResults")}
				triggerLabel={t("aiConfiguration.discovery.showModels")}
			/>
			{invalid && (
				<p id={errorId} role="alert" className="text-destructive text-xs">
					{t("aiConfiguration.fields.modelRequired")}
				</p>
			)}
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
	modelRole: role,
	value,
	onChange,
	providers,
	stored,
	drafts,
	disabled = false,
}: {
	modelRole: "text" | "embedding"
	value: RoleValue
	onChange: (value: RoleValue) => void
	providers: ProviderMetadata[]
	stored: RedactedRoleConfiguration | null
	drafts: RefObject<Map<string, RoleValue>>
	disabled?: boolean
}) {
	const { t } = useTranslation()
	const provider = providers.find(({ id }) => id === value.providerId) ?? providers[0]
	if (!provider) return null

	function selectProvider(providerId: AiProviderId) {
		if (providerId === value.providerId) return
		const next = providers.find((item) => item.id === providerId)
		if (!next) return
		drafts.current.set(`${role}:${value.providerId}`, {
			...value,
			settings: { ...value.settings },
			credentials: { ...value.credentials },
		})
		const draft = drafts.current.get(`${role}:${providerId}`)
		if (draft) {
			onChange({ ...draft, settings: { ...draft.settings }, credentials: { ...draft.credentials } })
			return
		}
		if (stored && stored.providerId === providerId) {
			onChange({
				providerId,
				modelId: stored.modelId,
				authMode: stored.authMode,
				settings: { ...stored.settings },
				credentials: {},
			})
			return
		}
		onChange({ providerId, modelId: "", authMode: next.authModes[0] ?? "static", settings: {}, credentials: {} })
	}

	return (
		<>
			<div className="space-y-2">
				<Label htmlFor={`${role}-provider`}>
					{t("aiConfiguration.fields.provider")} <RequiredMark />
				</Label>
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
					<Select<AiProviderAuthMode>
						value={value.authMode}
						onValueChange={(mode) => {
							if (mode === null) return
							onChange({ ...value, authMode: mode, credentials: {} })
						}}
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

			{provider.settingFields.map((field) => {
				const required = provider.requiredSettingFields.includes(field)
				return (
					<div className="space-y-2" key={field}>
						<Label htmlFor={`${role}-${field}`}>
							{fieldLabel(field, t)} {required && <RequiredMark />}
						</Label>
						<Input
							id={`${role}-${field}`}
							value={value.settings[field] ?? ""}
							disabled={disabled}
							required={required}
							onChange={(event) => onChange({ ...value, settings: { ...value.settings, [field]: event.target.value } })}
						/>
					</div>
				)
			})}

			{value.authMode === "static" && !disabled && (
				<CredentialsSection modelRole={role} provider={provider} value={value} onChange={onChange} stored={stored} />
			)}
		</>
	)
}

function CredentialsSection({
	modelRole: role,
	provider,
	value,
	onChange,
	stored,
}: {
	modelRole: "text" | "embedding"
	provider: ProviderMetadata
	value: RoleValue
	onChange: (value: RoleValue) => void
	stored: RedactedRoleConfiguration | null
}) {
	const { t } = useTranslation()
	const configured = storedCredentialsMatch({ provider, value, stored })
	const [replacingContext, setReplacingContext] = useState<string | null>(null)
	const contextSignature = useMemo(
		() => JSON.stringify([value.providerId, value.authMode, value.settings, provider.id]),
		[value.providerId, value.authMode, value.settings, provider.id],
	)
	const replacing = replacingContext === contextSignature

	if (provider.credentialFields.length === 0) return null

	if (configured && !replacing) {
		return (
			<div className="bg-muted/40 border-border h-control rounded-control flex items-center justify-between border pr-1 pl-4">
				<p className="text-muted-foreground flex items-center gap-2 text-sm">
					<LockIcon className="size-3.5" />
					{t("aiConfiguration.savedCredentials")}
				</p>
				<Button type="button" variant="ghost" size="sm" onClick={() => setReplacingContext(contextSignature)}>
					<PencilLineIcon data-icon="inline-start" />
					{t("aiConfiguration.replaceCredentials")}
				</Button>
			</div>
		)
	}

	return (
		<>
			{configured && (
				<p className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
					<span>{t("aiConfiguration.keepCredentialsNote")}</span>
					<button
						type="button"
						className="text-foreground shrink-0 underline underline-offset-2"
						onClick={() => {
							setReplacingContext(null)
							onChange({ ...value, credentials: {} })
						}}
					>
						{t("aiConfiguration.keepSavedCredentials")}
					</button>
				</p>
			)}
			{provider.credentialFields.map((field) => (
				<div className="space-y-2" key={field}>
					<Label htmlFor={`${role}-${field}`}>{fieldLabel(field, t)}</Label>
					<Input
						id={`${role}-${field}`}
						type="password"
						autoComplete="off"
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
	modelRole: "text" | "embedding"
	value: RoleValue
	onChange: (value: RoleValue) => void
	providers: ProviderMetadata[]
	stored: RedactedRoleConfiguration | null
	drafts: RefObject<Map<string, RoleValue>>
	disabled?: boolean
	invalid?: boolean
}) {
	const { t } = useTranslation()
	const { modelRole: role, value, onChange, providers, stored, disabled = false, invalid = false } = props
	const provider = providers.find(({ id }) => id === value.providerId) ?? providers[0]
	if (!provider) return null

	return (
		<div className="space-y-4">
			<ConnectionFields {...props} />
			<ModelField
				modelRole={role}
				label={role === "text" ? t("aiConfiguration.fields.textModel") : t("aiConfiguration.fields.embeddingModel")}
				modelId={value.modelId}
				onModelChange={(modelId) => onChange({ ...value, modelId })}
				provider={provider}
				value={value}
				stored={stored}
				storedCredentialRole={role}
				disabled={disabled}
				invalid={invalid}
			/>
		</div>
	)
}

export function AiConfigurationPage() {
	const { t } = useTranslation()
	const providersQuery = useListAiProviders()
	const configurationQuery = useGetAiProviderConfiguration()
	const save = useSaveAiProviderConfiguration()
	const [saved, setSaved] = useState(false)
	const [pendingSave, setPendingSave] = useState<AiConfigurationFormValues | null>(null)
	const drafts = useRef(new Map<string, RoleValue>())
	const {
		control,
		handleSubmit,
		reset,
		setValue,
		getValues,
		formState: { errors, isDirty },
	} = useForm<AiConfigurationFormValues>({
		resolver: zodResolver(aiConfigurationFormSchema),
		defaultValues: configurationToFormValues({ revision: 0, health: "unconfigured", text: null, embedding: null }),
	})
	const dirtyGuard = useDirtyFormGuard(isDirty)

	// Depend on the response body, not the envelope: its `headers` makes the envelope new on every refetch.
	const configuration = configurationQuery.data?.data
	useEffect(() => {
		if (!configuration) return
		drafts.current.clear()
		reset(configurationToFormValues(configuration))
	}, [configuration, reset])

	const watchedTextRole = useWatch({ control, name: "text" })

	if (providersQuery.isLoading || configurationQuery.isLoading)
		return (
			<>
				<output className="sr-only">{t("aiConfiguration.loading")}</output>
				<PageSkeleton />
			</>
		)
	if (!providersQuery.data || !configuration)
		return (
			<p role="alert" className="text-destructive">
				{t("aiConfiguration.loadError")}
			</p>
		)

	const storedEmbedding = configuration.embedding
	const providers = providersQuery.data.data.providers
	const embeddingProviders = providers.filter((provider) => provider.roles.includes("embedding"))

	async function saveConfiguration(values: AiConfigurationFormValues) {
		setSaved(false)
		try {
			await save.mutateAsync({ data: buildSaveInput(values) })
			setPendingSave(null)
			setSaved(true)
			await configurationQuery.refetch()
		} catch {
			// The mutation supplies the visible error; retain the draft for another attempt.
		}
	}

	async function onValid(values: AiConfigurationFormValues) {
		if (
			storedEmbedding &&
			(storedEmbedding.providerId !== values.embedding.providerId ||
				storedEmbedding.modelId !== values.embedding.modelId ||
				settingsKey(storedEmbedding.settings) !== settingsKey(values.embedding.settings))
		) {
			setPendingSave(values)
			return
		}
		await saveConfiguration(values)
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
		<div className="space-y-6">
			<PageHeader title={t("aiConfiguration.heading")} description={t("aiConfiguration.subheading")} />
			{configuration.health === "unusable" && (
				<p
					role="alert"
					className="border-destructive/30 bg-destructive/10 text-destructive rounded-surface p-surface-padding border text-sm"
				>
					{t("aiConfiguration.unusableWarning")}
				</p>
			)}
			<form onSubmit={handleSubmit(onValid, focusFirstInvalidModel)} className="space-y-6" noValidate>
				<p className="text-muted-foreground text-xs">{t("common.requiredHint")}</p>
				<Card>
					<CardHeader>
						<CardTitle level={2}>{t("aiConfiguration.textTitle")}</CardTitle>
						<CardDescription>{t("aiConfiguration.textDescription")}</CardDescription>
					</CardHeader>
					<CardContent>
						<Controller
							control={control}
							name="text"
							render={({ field }) => (
								<RoleFields
									// Remounts on a saved configuration, so "Replace" returns to the stored credentials.
									key={configuration.revision}
									modelRole="text"
									value={field.value}
									onChange={(next) => {
										field.onChange(next)
										onTextChange(next)
									}}
									providers={providers}
									stored={configuration.text}
									drafts={drafts}
									invalid={Boolean(errors.text?.modelId)}
								/>
							)}
						/>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle level={2}>{t("aiConfiguration.embeddingTitle")}</CardTitle>
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
													drafts.current.set("embedding:separate", {
														...field.value,
														settings: { ...field.value.settings },
														credentials: { ...field.value.credentials },
													})
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
													const draft = drafts.current.get("embedding:separate")
													if (draft) {
														field.onChange({
															...draft,
															settings: { ...draft.settings },
															credentials: { ...draft.credentials },
														})
														return
													}
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
											<TabsList aria-label={t("aiConfiguration.embeddingSourceLabel")}>
												<TabsTrigger value="same" disabled={!canReuse}>
													{t("aiConfiguration.tabs.sameProvider")}
												</TabsTrigger>
												<TabsTrigger value="different">{t("aiConfiguration.tabs.differentProvider")}</TabsTrigger>
											</TabsList>
											<TabsContent value="same">
												{textProvider && (
													<div className="space-y-4">
														<p className="text-muted-foreground flex items-center gap-2 text-sm">
															<ProviderBrand providerId={textProvider.id} />
															{t("aiConfiguration.sameProviderNote")}
														</p>
														<ModelField
															modelRole="embedding"
															label={t("aiConfiguration.fields.embeddingModel")}
															modelId={field.value.modelId}
															onModelChange={(modelId) => field.onChange({ ...field.value, modelId })}
															provider={textProvider}
															value={textRole}
															stored={configuration.text}
															storedCredentialRole="text"
															invalid={Boolean(errors.embedding?.modelId)}
														/>
													</div>
												)}
											</TabsContent>
											<TabsContent value="different">
												{sameProvider ? null : (
													<RoleFields
														key={configuration.revision}
														modelRole="embedding"
														value={field.value}
														onChange={field.onChange}
														providers={embeddingProviders}
														stored={configuration.embedding}
														drafts={drafts}
														invalid={Boolean(errors.embedding?.modelId)}
													/>
												)}
											</TabsContent>
										</Tabs>
										{!canReuse && (
											<p className="text-muted-foreground text-xs">{t("aiConfiguration.sameProviderUnavailable")}</p>
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
						{getProblemMessage(save.error, t, t("aiConfiguration.saveFailed"))}
					</p>
				)}
				<FormActions status={saved && !isDirty ? t("aiConfiguration.saved") : undefined}>
					<Button type="submit" disabled={save.isPending || !isDirty}>
						{save.isPending ? t("aiConfiguration.saving") : t("aiConfiguration.save")}
					</Button>
				</FormActions>
			</form>
			{dirtyGuard}
			<Dialog
				open={pendingSave !== null}
				onOpenChange={(open) => {
					if (!open && !save.isPending) setPendingSave(null)
				}}
			>
				<DialogContent closeLabel={t("common.close")}>
					<DialogHeader>
						<DialogTitle>{t("aiConfiguration.reembedTitle")}</DialogTitle>
						<DialogDescription>{t("aiConfiguration.reembedWarning")}</DialogDescription>
					</DialogHeader>
					{save.isError && (
						<p role="alert" className="text-destructive text-sm">
							{getProblemMessage(save.error, t, t("aiConfiguration.saveFailed"))}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="outline" disabled={save.isPending} onClick={() => setPendingSave(null)}>
							{t("aiConfiguration.reembedCancel")}
						</Button>
						<Button
							type="button"
							disabled={save.isPending}
							onClick={() => {
								if (pendingSave) void saveConfiguration(pendingSave)
							}}
						>
							{save.isPending ? t("aiConfiguration.saving") : t("aiConfiguration.reembedConfirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
