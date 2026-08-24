import type { AiProviderAuthMode, ProviderMetadata, RedactedRoleConfiguration } from "./types.ts"

export type DiscoveryContext = {
	provider: ProviderMetadata
	value: {
		authMode: AiProviderAuthMode
		settings: Record<string, string>
		credentials: Record<string, string>
	}
	stored: RedactedRoleConfiguration | null
}

function sameSettings(left: Record<string, string>, right: Record<string, string>): boolean {
	const leftEntries = Object.entries(left).toSorted(([a], [b]) => a.localeCompare(b))
	const rightEntries = Object.entries(right).toSorted(([a], [b]) => a.localeCompare(b))
	return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

function hasRequiredSettings(provider: ProviderMetadata, settings: Record<string, string>): boolean {
	return provider.requiredSettingFields.every((field) => settings[field]?.trim())
}

export function requiredCredentials(
	provider: ProviderMetadata,
	credentials: Record<string, string>,
): Record<string, string> {
	const entries = provider.requiredCredentialFields.map((field) => [field, credentials[field] ?? ""] as const)
	return Object.fromEntries(entries.filter(([, value]) => value.trim()))
}

export function hasCompleteCredentials(provider: ProviderMetadata, credentials: Record<string, string>): boolean {
	return provider.requiredCredentialFields.every((field) => Boolean(credentials[field]?.trim()))
}

export function supportsDiscovery(provider: ProviderMetadata, authMode: AiProviderAuthMode): boolean {
	return provider.discovery && authMode === "static"
}

export function storedCredentialsMatch(context: DiscoveryContext): boolean {
	const { provider, value, stored } = context
	return (
		stored !== null &&
		stored.hasCredentials &&
		stored.providerId === provider.id &&
		stored.authMode === value.authMode &&
		sameSettings(stored.settings, value.settings)
	)
}

export function isDiscoveryReady(context: DiscoveryContext): boolean {
	if (!supportsDiscovery(context.provider, context.value.authMode)) return false
	if (!hasRequiredSettings(context.provider, context.value.settings)) return false
	return hasCompleteCredentials(context.provider, context.value.credentials) || storedCredentialsMatch(context)
}
