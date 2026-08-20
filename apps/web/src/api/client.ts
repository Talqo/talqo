import { ApiError } from "./errors.ts"

const NO_CONTENT_STATUS = 204

export type PublicUser = {
	id: string
	username: string
}

export type Permission = "users:invite" | "ai_provider:manage"
export type AiProviderId =
	| "openai"
	| "anthropic"
	| "google"
	| "mistral"
	| "azure"
	| "amazon-bedrock"
	| "openai-compatible"
export type AiProviderRole = "text" | "embedding"
export type AiProviderAuthMode = "static" | "deployment-identity"

export type ProviderMetadata = {
	id: AiProviderId
	roles: AiProviderRole[]
	authModes: AiProviderAuthMode[]
	settingFields: string[]
	requiredSettingFields: string[]
	credentialFields: string[]
	requiredCredentialFields: string[]
}

export type RedactedRoleConfiguration = {
	providerId: AiProviderId
	modelId: string
	authMode: AiProviderAuthMode
	settings: Record<string, string>
	hasCredentials: boolean
}

export type AiProviderConfiguration = {
	revision: number
	health: "unconfigured" | "configured" | "unusable"
	text: RedactedRoleConfiguration | null
	embedding: (RedactedRoleConfiguration & { credentialSource: "text" | "separate" | "deployment-identity" }) | null
}

export type RoleConfigurationInput = {
	providerId: AiProviderId
	modelId: string
	authMode: AiProviderAuthMode
	settings: Record<string, string>
	credentials?: Record<string, string>
}

export type SaveAiProviderConfigurationInput = {
	expectedRevision: number
	text: RoleConfigurationInput
	embedding: RoleConfigurationInput & { credentialSource: "text" | "separate" | "deployment-identity" }
}

function isErrorBody(body: unknown): body is { error: string } {
	return (
		typeof body === "object" &&
		body !== null &&
		"error" in body &&
		typeof (body as { error: unknown }).error === "string"
	)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, {
		...init,
		credentials: "include",
		headers: { "Content-Type": "application/json", ...init?.headers },
	})

	if (response.status === NO_CONTENT_STATUS) return undefined as T

	const body: unknown = await response.json().catch(() => undefined)

	if (!response.ok) {
		throw new ApiError(response.status, isErrorBody(body) ? body.error : response.statusText)
	}

	return body as T
}

export function getSetupStatus(signal?: AbortSignal): Promise<{ needsSetup: boolean }> {
	return request("/api/setup", { signal })
}

export function bootstrapAdmin(input: { password: string; username: string }): Promise<{ user: PublicUser }> {
	return request("/api/setup", { method: "POST", body: JSON.stringify(input) })
}

export function login(input: { password: string; username: string }): Promise<{ user: PublicUser }> {
	return request("/api/auth/login", { method: "POST", body: JSON.stringify(input) })
}

export function logout(): Promise<void> {
	return request("/api/auth/logout", { method: "POST" })
}

export function getSession(signal?: AbortSignal): Promise<{ user: PublicUser | null }> {
	return request("/api/auth/session", { signal })
}

export function createInvitation(): Promise<{ expiresAt: string; token: string }> {
	return request("/api/invitations", { method: "POST" })
}

export function redeemInvitation(input: {
	password: string
	token: string
	username: string
}): Promise<{ user: PublicUser }> {
	return request("/api/invitations/redeem", { method: "POST", body: JSON.stringify(input) })
}

export function getAccess(signal?: AbortSignal): Promise<{ isAdmin: boolean; permissions: Permission[] }> {
	return request("/api/access", { signal })
}

export function getAiProviders(signal?: AbortSignal): Promise<{ providers: ProviderMetadata[] }> {
	return request("/api/ai-providers", { signal })
}

export function getAiProviderConfiguration(signal?: AbortSignal): Promise<AiProviderConfiguration> {
	return request("/api/ai-provider-configuration", { signal })
}

export function discoverAiProviderModels(input: {
	providerId: AiProviderId
	authMode: AiProviderAuthMode
	settings: Record<string, string>
	credentials?: Record<string, string>
	storedCredentialRole?: AiProviderRole
}): Promise<{ models: string[] }> {
	return request("/api/ai-provider-models/discover", { method: "POST", body: JSON.stringify(input) })
}

export function saveAiProviderConfiguration(input: SaveAiProviderConfigurationInput): Promise<AiProviderConfiguration> {
	return request("/api/ai-provider-configuration", { method: "PUT", body: JSON.stringify(input) })
}
