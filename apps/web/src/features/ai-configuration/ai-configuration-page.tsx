import type { GetAiProviderConfiguration200 } from "@/api/generated/models/ai-providers/getAiProviderConfiguration200.zod.ts"
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
import { ProblemAlert } from "@/components/problem-alert"
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
import {
	type Control,
	Controller,
	type ControllerRenderProps,
	type FieldErrors,
	useForm,
	useWatch,
} from "react-hook-form"
import { useTranslation } from "react-i18next"

type RoleValue = RoleConfigurationInput & {
	credentials: Record<string, string>
	credentialSource?: AiConfigurationFormValues["embedding"]["credentialSource"]
}
type MissingField = { field: string; kind: "credential" | "setting"; role: "text" | "embedding" }

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
	if (errors.text?.modelId) {
		document.getElementById("text-model")?.focus()
		return
	}
	if (errors.embedding?.modelId) document.getElementById("embedding-model")?.focus()
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
	providers: Array<ProviderMetadata>
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
	credentialRevision,
	missing,
}: {
	modelRole: "text" | "embedding"
	value: RoleValue
	onChange: (value: RoleValue) => void
	providers: Array<ProviderMetadata>
	stored: RedactedRoleConfiguration | null
	drafts: RefObject<Map<string, RoleValue>>
	disabled?: boolean
	credentialRevision: number
	missing?: MissingField
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
		const restored = stored && stored.providerId === providerId ? stored : undefined
		const authMode = restored?.authMode ?? next.authModes[0] ?? "static"
		onChange({
			...value,
			providerId,
			modelId: restored?.modelId ?? "",
			authMode,
			settings: restored ? { ...restored.settings } : {},
			credentials: {},
			...(role === "embedding"
				? { credentialSource: authMode === "deployment-identity" ? "deployment-identity" : "separate" }
				: {}),
		})
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
							<SelectValue>{(mode: AiProviderAuthMode) => authModeLabel(mode, t)}</SelectValue>
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
				const invalid =
					required && missing?.kind === "setting" && missing.field === field && !value.settings[field]?.trim()
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
							aria-invalid={invalid}
							aria-describedby={invalid ? `${role}-${field}-error` : undefined}
							onChange={(event) => onChange({ ...value, settings: { ...value.settings, [field]: event.target.value } })}
						/>
						{invalid && (
							<p id={`${role}-${field}-error`} role="alert" className="text-destructive text-xs">
								{t("aiConfiguration.fields.fieldRequired")}
							</p>
						)}
					</div>
				)
			})}

			{value.authMode === "static" && !disabled && (
				<CredentialsSection
					key={credentialRevision}
					modelRole={role}
					provider={provider}
					value={value}
					onChange={onChange}
					stored={stored}
					missing={missing}
				/>
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
	missing,
}: {
	modelRole: "text" | "embedding"
	provider: ProviderMetadata
	value: RoleValue
	onChange: (value: RoleValue) => void
	stored: RedactedRoleConfiguration | null
	missing?: MissingField
}) {
	const { t } = useTranslation()
	const configured = storedCredentialsMatch({ provider, value, stored })
	const storedCredentials =
		stored !== null && stored.hasCredentials && stored.providerId === provider.id && stored.authMode === value.authMode
	const drafting = Object.values(value.credentials).some((credential) => credential.trim())
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
			{provider.credentialFields.map((field) => {
				const required = (!storedCredentials || drafting) && provider.requiredCredentialFields.includes(field)
				const invalid =
					required && missing?.kind === "credential" && missing.field === field && !value.credentials[field]?.trim()
				return (
					<div className="space-y-2" key={field}>
						<Label htmlFor={`${role}-${field}`}>
							{fieldLabel(field, t)} {required && <RequiredMark />}
						</Label>
						<Input
							id={`${role}-${field}`}
							type="password"
							autoComplete="off"
							required={required}
							aria-invalid={invalid}
							aria-describedby={invalid ? `${role}-${field}-error` : undefined}
							value={value.credentials[field] ?? ""}
							onChange={(event) =>
								onChange({ ...value, credentials: { ...value.credentials, [field]: event.target.value } })
							}
						/>
						{invalid && (
							<p id={`${role}-${field}-error`} role="alert" className="text-destructive text-xs">
								{t("aiConfiguration.fields.fieldRequired")}
							</p>
						)}
					</div>
				)
			})}
		</>
	)
}

function RoleFields(props: {
	modelRole: "text" | "embedding"
	value: RoleValue
	onChange: (value: RoleValue) => void
	providers: Array<ProviderMetadata>
	stored: RedactedRoleConfiguration | null
	drafts: RefObject<Map<string, RoleValue>>
	disabled?: boolean
	credentialRevision: number
	invalid?: boolean
	missing?: MissingField
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

type SaveMutation = ReturnType<typeof useSaveAiProviderConfiguration>

function findMissingField(
	values: AiConfigurationFormValues,
	providers: Array<ProviderMetadata>,
	storedText: RedactedRoleConfiguration | null,
	storedEmbedding: RedactedRoleConfiguration | null,
): MissingField | undefined {
	for (const role of ["text", "embedding"] as const) {
		if (role === "embedding" && values.embedding.credentialSource === "text") continue
		const missing = missingRoleField(role, values, providers, role === "text" ? storedText : storedEmbedding)
		if (missing) return missing
	}
	return undefined
}

function missingRoleField(
	role: "text" | "embedding",
	values: AiConfigurationFormValues,
	providers: Array<ProviderMetadata>,
	stored: RedactedRoleConfiguration | null,
): MissingField | undefined {
	const roleValues = values[role]
	const provider = providers.find((item) => item.id === roleValues.providerId)
	if (!provider) return undefined
	const missingSetting = provider.requiredSettingFields.find((field) => !roleValues.settings[field]?.trim())
	if (missingSetting) return { field: missingSetting, kind: "setting", role }
	if (roleValues.authMode !== "static") return undefined
	const storedCredentials =
		stored !== null &&
		stored.hasCredentials &&
		stored.providerId === provider.id &&
		stored.authMode === roleValues.authMode
	const drafting = Object.values(roleValues.credentials).some((credential) => credential.trim())
	if (storedCredentials && !drafting) return undefined
	const missingCredential = provider.requiredCredentialFields.find((field) => !roleValues.credentials[field]?.trim())
	return missingCredential ? { field: missingCredential, kind: "credential", role } : undefined
}

function embeddingChanged(
	stored: RedactedRoleConfiguration | null,
	values: AiConfigurationFormValues["embedding"],
): boolean {
	if (!stored) return false
	return (
		stored.providerId !== values.providerId ||
		stored.modelId !== values.modelId ||
		settingsKey(stored.settings) !== settingsKey(values.settings)
	)
}

function embeddingForTextChange(
	next: RoleValue,
	embedding: AiConfigurationFormValues["embedding"],
	providers: Array<ProviderMetadata>,
	embeddingProviders: Array<ProviderMetadata>,
): AiConfigurationFormValues["embedding"] | undefined {
	if (embedding.credentialSource !== "text") return undefined
	const nextProvider = providers.find((provider) => provider.id === next.providerId)
	if (nextProvider?.roles.includes("embedding")) {
		return {
			...embedding,
			providerId: next.providerId,
			authMode: next.authMode,
			settings: next.settings,
			credentials: next.credentials,
		}
	}
	const fallback = embeddingProviders[0]
	if (!fallback) return undefined
	return {
		providerId: fallback.id,
		modelId: embedding.modelId,
		authMode: fallback.authModes[0] ?? "static",
		settings: {},
		credentials: {},
		credentialSource: "separate",
	}
}

function useConfigurationForm(configuration: GetAiProviderConfiguration200 | undefined) {
	const drafts = useRef(new Map<string, RoleValue>())
	const form = useForm<AiConfigurationFormValues>({
		resolver: zodResolver(aiConfigurationFormSchema),
		defaultValues: configurationToFormValues({ revision: 0, health: "unconfigured", text: null, embedding: null }),
	})
	const dirtyGuard = useDirtyFormGuard(form.formState.isDirty)
	const { reset } = form
	useEffect(() => {
		if (!configuration) return
		drafts.current.clear()
		reset(configurationToFormValues(configuration))
	}, [configuration, reset])
	const watchedTextRole = useWatch({ control: form.control, name: "text" })
	return { ...form, drafts, dirtyGuard, watchedTextRole }
}

function useConfigurationSave(props: {
	providers: Array<ProviderMetadata>
	storedText: RedactedRoleConfiguration | null
	storedEmbedding: RedactedRoleConfiguration | null
	save: SaveMutation
	refetch: () => Promise<unknown>
}) {
	const { providers, storedText, storedEmbedding, save, refetch } = props
	const [saved, setSaved] = useState(false)
	const [pendingSave, setPendingSave] = useState<AiConfigurationFormValues | null>(null)
	const [missingField, setMissingField] = useState<MissingField | null>(null)

	async function saveConfiguration(values: AiConfigurationFormValues) {
		setSaved(false)
		try {
			await save.mutateAsync({ data: buildSaveInput(values) })
			setPendingSave(null)
			setSaved(true)
			await refetch()
		} catch {
			// The mutation supplies the visible error; retain the draft for another attempt.
		}
	}

	async function onValid(values: AiConfigurationFormValues) {
		const missing = findMissingField(values, providers, storedText, storedEmbedding)
		if (missing) {
			setMissingField(missing)
			document.getElementById(`${missing.role}-${missing.field}`)?.focus()
			return
		}
		setMissingField(null)
		if (embeddingChanged(storedEmbedding, values.embedding)) {
			setPendingSave(values)
			return
		}
		await saveConfiguration(values)
	}

	return { saved, pendingSave, setPendingSave, missingField, onValid, saveConfiguration }
}

type TextRoleCardProps = {
	control: Control<AiConfigurationFormValues>
	errors: FieldErrors<AiConfigurationFormValues>
	providers: Array<ProviderMetadata>
	stored: RedactedRoleConfiguration | null
	drafts: RefObject<Map<string, RoleValue>>
	credentialRevision: number
	missing?: MissingField
	onTextChange: (value: RoleValue) => void
}

function TextRoleCard(props: TextRoleCardProps) {
	const { t } = useTranslation()
	const { control, errors, providers, stored, drafts, credentialRevision, missing, onTextChange } = props
	return (
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
							modelRole="text"
							value={field.value}
							onChange={(next) => {
								field.onChange(next)
								onTextChange(next)
							}}
							providers={providers}
							stored={stored}
							drafts={drafts}
							credentialRevision={credentialRevision}
							invalid={Boolean(errors.text?.modelId)}
							missing={missing?.role === "text" ? missing : undefined}
						/>
					)}
				/>
			</CardContent>
		</Card>
	)
}

type EmbeddingSourceFieldsProps = {
	field: ControllerRenderProps<AiConfigurationFormValues, "embedding">
	textRole: AiConfigurationFormValues["text"]
	textProvider: ProviderMetadata | undefined
	embeddingProviders: Array<ProviderMetadata>
	errors: FieldErrors<AiConfigurationFormValues>
	storedText: RedactedRoleConfiguration | null
	storedEmbedding: RedactedRoleConfiguration | null
	drafts: RefObject<Map<string, RoleValue>>
	credentialRevision: number
	missing?: MissingField
}

type EmbeddingSourceChange = Pick<EmbeddingSourceFieldsProps, "field" | "textRole" | "textProvider" | "drafts">

function changeEmbeddingSource(next: string, props: EmbeddingSourceChange) {
	const { field, textRole, textProvider, drafts } = props
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
	const sameProvider = field.value.credentialSource === "text"
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
}

function SameEmbeddingTab(
	props: Pick<EmbeddingSourceFieldsProps, "field" | "textRole" | "textProvider" | "storedText" | "errors">,
) {
	if (!props.textProvider) return null
	return (
		<TabsContent value="same">
			<SameEmbeddingPanel
				field={props.field}
				textRole={props.textRole}
				textProvider={props.textProvider}
				stored={props.storedText}
				invalid={Boolean(props.errors.embedding?.modelId)}
			/>
		</TabsContent>
	)
}

type DifferentEmbeddingTabProps = Pick<
	EmbeddingSourceFieldsProps,
	"field" | "embeddingProviders" | "storedEmbedding" | "drafts" | "credentialRevision" | "errors" | "missing"
> & { sameProvider: boolean }

function DifferentEmbeddingTab(props: DifferentEmbeddingTabProps) {
	return (
		<TabsContent value="different">
			{props.sameProvider ? null : (
				<RoleFields
					modelRole="embedding"
					value={props.field.value}
					onChange={props.field.onChange}
					providers={props.embeddingProviders}
					stored={props.storedEmbedding}
					drafts={props.drafts}
					credentialRevision={props.credentialRevision}
					invalid={Boolean(props.errors.embedding?.modelId)}
					missing={props.missing?.role === "embedding" ? props.missing : undefined}
				/>
			)}
		</TabsContent>
	)
}

function EmbeddingSourceFields(props: EmbeddingSourceFieldsProps) {
	const { t } = useTranslation()
	const canReuse = props.textProvider?.roles.includes("embedding") ?? false
	const sameProvider = props.field.value.credentialSource === "text"
	return (
		<div className="space-y-4">
			<Tabs
				value={sameProvider ? "same" : "different"}
				onValueChange={(next: string) => changeEmbeddingSource(next, props)}
			>
				<TabsList aria-label={t("aiConfiguration.embeddingSourceLabel")}>
					<TabsTrigger value="same" disabled={!canReuse}>
						{t("aiConfiguration.tabs.sameProvider")}
					</TabsTrigger>
					<TabsTrigger value="different">{t("aiConfiguration.tabs.differentProvider")}</TabsTrigger>
				</TabsList>
				<SameEmbeddingTab {...props} />
				<DifferentEmbeddingTab {...props} sameProvider={sameProvider} />
			</Tabs>
			{!canReuse && <p className="text-muted-foreground text-xs">{t("aiConfiguration.sameProviderUnavailable")}</p>}
		</div>
	)
}

function SameEmbeddingPanel(props: {
	field: ControllerRenderProps<AiConfigurationFormValues, "embedding">
	textRole: AiConfigurationFormValues["text"]
	textProvider: ProviderMetadata
	stored: RedactedRoleConfiguration | null
	invalid: boolean
}) {
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<p className="text-muted-foreground flex items-center gap-2 text-sm">
				<ProviderBrand providerId={props.textProvider.id} />
				{t("aiConfiguration.sameProviderNote")}
			</p>
			<ModelField
				modelRole="embedding"
				label={t("aiConfiguration.fields.embeddingModel")}
				modelId={props.field.value.modelId}
				onModelChange={(modelId) => props.field.onChange({ ...props.field.value, modelId })}
				provider={props.textProvider}
				value={props.textRole}
				stored={props.stored}
				storedCredentialRole="text"
				invalid={props.invalid}
			/>
		</div>
	)
}

type EmbeddingRoleCardProps = {
	control: Control<AiConfigurationFormValues>
	errors: FieldErrors<AiConfigurationFormValues>
	providers: Array<ProviderMetadata>
	embeddingProviders: Array<ProviderMetadata>
	textRole: AiConfigurationFormValues["text"]
	storedText: RedactedRoleConfiguration | null
	storedEmbedding: RedactedRoleConfiguration | null
	drafts: RefObject<Map<string, RoleValue>>
	credentialRevision: number
	missing?: MissingField
}

function EmbeddingRoleCard(props: EmbeddingRoleCardProps) {
	const { t } = useTranslation()
	const { control, providers, textRole, errors, ...rest } = props
	return (
		<Card>
			<CardHeader>
				<CardTitle level={2}>{t("aiConfiguration.embeddingTitle")}</CardTitle>
				<CardDescription>{t("aiConfiguration.embeddingDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<Controller
					control={control}
					name="embedding"
					render={({ field }) => (
						<EmbeddingSourceFields
							field={field}
							textRole={textRole}
							textProvider={providers.find((provider) => provider.id === textRole.providerId)}
							errors={errors}
							{...rest}
						/>
					)}
				/>
			</CardContent>
		</Card>
	)
}

function ConfigurationFormStatus(props: {
	errors: FieldErrors<AiConfigurationFormValues>
	save: SaveMutation
	saved: boolean
	isDirty: boolean
}) {
	const { t } = useTranslation()
	return (
		<>
			{Object.keys(props.errors).length > 0 && (
				<p role="alert" className="text-destructive text-sm">
					{t("aiConfiguration.validationError")}
				</p>
			)}
			{props.save.isError && (
				<p role="alert" className="text-destructive text-sm">
					{getProblemMessage(props.save.error, t, t("aiConfiguration.saveFailed"))}
				</p>
			)}
			<FormActions status={props.saved && !props.isDirty ? t("aiConfiguration.saved") : undefined}>
				<Button type="submit" disabled={props.save.isPending || !props.isDirty}>
					{props.save.isPending ? t("aiConfiguration.saving") : t("aiConfiguration.save")}
				</Button>
			</FormActions>
		</>
	)
}

type ConfigurationFormProps = {
	control: Control<AiConfigurationFormValues>
	errors: FieldErrors<AiConfigurationFormValues>
	isDirty: boolean
	saved: boolean
	save: SaveMutation
	providers: Array<ProviderMetadata>
	embeddingProviders: Array<ProviderMetadata>
	textRole: AiConfigurationFormValues["text"]
	storedText: RedactedRoleConfiguration | null
	storedEmbedding: RedactedRoleConfiguration | null
	drafts: RefObject<Map<string, RoleValue>>
	credentialRevision: number
	missingField: MissingField | null
	onTextChange: (value: RoleValue) => void
	onSubmit: () => void
}

function ConfigurationForm(props: ConfigurationFormProps) {
	const { t } = useTranslation()
	const {
		control,
		errors,
		isDirty,
		saved,
		save,
		providers,
		embeddingProviders,
		textRole,
		storedText,
		storedEmbedding,
		drafts,
		credentialRevision,
		missingField,
		onTextChange,
		onSubmit,
	} = props
	return (
		<form
			className="space-y-6"
			noValidate
			onSubmit={(event) => {
				event.preventDefault()
				onSubmit()
			}}
		>
			<p className="text-muted-foreground text-xs">{t("common.requiredHint")}</p>
			<TextRoleCard
				control={control}
				errors={errors}
				providers={providers}
				stored={storedText}
				drafts={drafts}
				credentialRevision={credentialRevision}
				missing={missingField?.role === "text" ? missingField : undefined}
				onTextChange={onTextChange}
			/>
			<EmbeddingRoleCard
				control={control}
				errors={errors}
				providers={providers}
				embeddingProviders={embeddingProviders}
				textRole={textRole}
				storedText={storedText}
				storedEmbedding={storedEmbedding}
				drafts={drafts}
				credentialRevision={credentialRevision}
				missing={missingField?.role === "embedding" ? missingField : undefined}
			/>
			<ConfigurationFormStatus errors={errors} save={save} saved={saved} isDirty={isDirty} />
		</form>
	)
}

function ReembedDialog(props: {
	open: boolean
	pendingSave: AiConfigurationFormValues | null
	save: SaveMutation
	onClose: () => void
	onConfirm: (values: AiConfigurationFormValues) => void
}) {
	const { t } = useTranslation()
	const { save, pendingSave } = props
	return (
		<Dialog
			open={props.open}
			onOpenChange={(open) => {
				if (!open && !save.isPending) props.onClose()
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
					<Button type="button" variant="outline" disabled={save.isPending} onClick={props.onClose}>
						{t("aiConfiguration.reembedCancel")}
					</Button>
					<Button
						type="button"
						disabled={save.isPending}
						onClick={() => {
							if (pendingSave) props.onConfirm(pendingSave)
						}}
					>
						{save.isPending ? t("aiConfiguration.saving") : t("aiConfiguration.reembedConfirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function AiConfigurationEditor(props: {
	configuration: GetAiProviderConfiguration200
	providers: Array<ProviderMetadata>
	save: SaveMutation
	refetch: () => Promise<unknown>
}) {
	const { t } = useTranslation()
	const { configuration, providers, save, refetch } = props
	const form = useConfigurationForm(configuration)
	const saveState = useConfigurationSave({
		providers,
		storedText: configuration.text,
		storedEmbedding: configuration.embedding,
		save,
		refetch,
	})
	const embeddingProviders = providers.filter((provider) => provider.roles.includes("embedding"))

	function onTextChange(next: RoleValue) {
		const embedding = embeddingForTextChange(next, form.getValues("embedding"), providers, embeddingProviders)
		if (embedding) form.setValue("embedding", embedding)
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
			<ConfigurationForm
				control={form.control}
				errors={form.formState.errors}
				isDirty={form.formState.isDirty}
				saved={saveState.saved}
				save={save}
				providers={providers}
				embeddingProviders={embeddingProviders}
				textRole={form.watchedTextRole}
				storedText={configuration.text}
				storedEmbedding={configuration.embedding}
				drafts={form.drafts}
				credentialRevision={configuration.revision}
				missingField={saveState.missingField}
				onTextChange={onTextChange}
				onSubmit={form.handleSubmit(saveState.onValid, focusFirstInvalidModel)}
			/>
			{form.dirtyGuard}
			<ReembedDialog
				open={saveState.pendingSave !== null}
				pendingSave={saveState.pendingSave}
				save={save}
				onClose={() => saveState.setPendingSave(null)}
				onConfirm={(values) => void saveState.saveConfiguration(values)}
			/>
		</div>
	)
}

export function AiConfigurationPage() {
	const { t } = useTranslation()
	const providersQuery = useListAiProviders()
	const configurationQuery = useGetAiProviderConfiguration()
	const save = useSaveAiProviderConfiguration()
	const configuration = configurationQuery.data?.data

	if (providersQuery.isLoading || configurationQuery.isLoading)
		return (
			<>
				<output className="sr-only">{t("aiConfiguration.loading")}</output>
				<PageSkeleton />
			</>
		)
	if (providersQuery.isError || configurationQuery.isError || !providersQuery.data || !configuration)
		return (
			<div className="space-y-6">
				<PageHeader title={t("aiConfiguration.heading")} description={t("aiConfiguration.subheading")} />
				<ProblemAlert
					error={providersQuery.error ?? configurationQuery.error}
					fallback={t("aiConfiguration.loadError")}
					onRetry={() => {
						void providersQuery.refetch()
						void configurationQuery.refetch()
					}}
				/>
			</div>
		)

	return (
		<AiConfigurationEditor
			configuration={configuration}
			providers={providersQuery.data.data.providers}
			save={save}
			refetch={configurationQuery.refetch}
		/>
	)
}
