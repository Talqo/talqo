export const AI_PROVIDER_ROLES = ["text", "embedding"] as const
export type AiProviderRole = (typeof AI_PROVIDER_ROLES)[number]

export const AI_PROVIDER_IDS = [
	"openai",
	"anthropic",
	"google",
	"mistral",
	"azure",
	"amazon-bedrock",
	"openai-compatible",
] as const
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]

export const AUTH_MODES = ["static", "deployment-identity"] as const
export type AuthMode = (typeof AUTH_MODES)[number]

export const SETTING_FIELDS = ["baseURL", "project", "apiVersion", "region"] as const
export type SettingField = (typeof SETTING_FIELDS)[number]

export const CREDENTIAL_FIELDS = ["apiKey", "accessKeyId", "secretAccessKey", "sessionToken"] as const
export type CredentialField = (typeof CREDENTIAL_FIELDS)[number]

export type ProviderDefinition = {
	authModes: readonly AuthMode[]
	credentialFields: readonly CredentialField[]
	discovery: boolean
	id: AiProviderId
	requiredCredentialFields: readonly CredentialField[]
	requiredSettingFields: readonly SettingField[]
	roles: readonly AiProviderRole[]
	settingFields: readonly SettingField[]
}

export const PROVIDER_DEFINITIONS = [
	{
		id: "openai",
		roles: ["text", "embedding"],
		authModes: ["static"],
		settingFields: ["project"],
		credentialFields: ["apiKey"],
		requiredSettingFields: [],
		requiredCredentialFields: ["apiKey"],
		discovery: true,
	},
	{
		id: "anthropic",
		roles: ["text"],
		authModes: ["static"],
		settingFields: [],
		credentialFields: ["apiKey"],
		requiredSettingFields: [],
		requiredCredentialFields: ["apiKey"],
		discovery: true,
	},
	{
		id: "google",
		roles: ["text", "embedding"],
		authModes: ["static"],
		settingFields: [],
		credentialFields: ["apiKey"],
		requiredSettingFields: [],
		requiredCredentialFields: ["apiKey"],
		discovery: true,
	},
	{
		id: "mistral",
		roles: ["text", "embedding"],
		authModes: ["static"],
		settingFields: ["baseURL"],
		credentialFields: ["apiKey"],
		requiredSettingFields: [],
		requiredCredentialFields: ["apiKey"],
		discovery: true,
	},
	{
		id: "azure",
		roles: ["text", "embedding"],
		authModes: ["static", "deployment-identity"],
		settingFields: ["baseURL", "apiVersion"],
		credentialFields: ["apiKey"],
		requiredSettingFields: ["baseURL"],
		requiredCredentialFields: ["apiKey"],
		discovery: false,
	},
	{
		id: "amazon-bedrock",
		roles: ["text", "embedding"],
		authModes: ["static", "deployment-identity"],
		settingFields: ["region"],
		credentialFields: ["accessKeyId", "secretAccessKey", "sessionToken"],
		requiredSettingFields: ["region"],
		requiredCredentialFields: ["accessKeyId", "secretAccessKey"],
		discovery: false,
	},
	{
		id: "openai-compatible",
		roles: ["text", "embedding"],
		authModes: ["static"],
		settingFields: ["baseURL"],
		credentialFields: ["apiKey"],
		requiredSettingFields: ["baseURL"],
		requiredCredentialFields: ["apiKey"],
		discovery: true,
	},
] as const satisfies readonly ProviderDefinition[]

export function getProviderDefinition(id: string): ProviderDefinition {
	const provider = PROVIDER_DEFINITIONS.find((definition) => definition.id === id)
	if (!provider) throw new Error(`Unsupported AI provider: ${id}`)
	return provider
}
