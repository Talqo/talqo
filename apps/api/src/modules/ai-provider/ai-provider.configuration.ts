import { sameStringRecord } from "@talqo/shared"

import type { SaveConfigurationInput } from "./ai-provider.contract.ts"
import type { ProviderDefinition } from "./ai-provider.registry.ts"

import { getProviderDefinition } from "./ai-provider.registry.ts"
import { assertHttpBaseUrl } from "./base-url.ts"

type RoleInput = (SaveConfigurationInput["text"] | SaveConfigurationInput["embedding"]) & {
	existingCredentials?: boolean
}

function assertNonEmptyFields(
	values: Record<string, string> | undefined,
	fields: readonly string[],
	label: string,
): void {
	for (const field of fields) {
		if (!values?.[field]?.trim()) throw new Error(`${label} are required: ${field}`)
	}
}

function assertAllowedSettings(
	providerId: string,
	settings: Record<string, string>,
	provider: ProviderDefinition,
): void {
	for (const key of Object.keys(settings)) {
		if (!provider.settingFields.includes(key as (typeof provider.settingFields)[number])) {
			throw new Error(`${providerId} does not support setting: ${key}`)
		}
	}
}

function assertBaseUrl(input: RoleInput): void {
	if (!input.settings.baseURL) return
	try {
		assertHttpBaseUrl(input.settings.baseURL)
	} catch (error) {
		throw new Error(error instanceof Error ? error.message : `${input.providerId} baseURL is invalid`, {
			cause: error,
		})
	}
}

function assertRequiredCredentials(
	provider: ProviderDefinition,
	input: RoleInput,
	requireStaticCredentials: boolean,
): void {
	if (requireStaticCredentials && input.authMode === "static" && !input.existingCredentials) {
		assertNonEmptyFields(input.credentials, provider.requiredCredentialFields, `${input.providerId} credentials`)
	}
}

function assertRole(role: "text" | "embedding", input: RoleInput, requireStaticCredentials: boolean): void {
	const provider = getProviderDefinition(input.providerId)
	if (!provider.roles.includes(role)) throw new Error(`${input.providerId} does not support ${role}`)
	if (!provider.authModes.includes(input.authMode)) {
		throw new Error(`${input.providerId} does not support ${input.authMode} authentication`)
	}
	assertNonEmptyFields(input.settings, provider.requiredSettingFields, `${input.providerId} setting`)
	assertAllowedSettings(input.providerId, input.settings, provider)
	assertBaseUrl(input)
	assertRequiredCredentials(provider, input, requireStaticCredentials)
}

function assertReusedCredentialContext(input: SaveConfigurationInput): void {
	if (input.embedding.credentialSource !== "text") return
	if (
		input.text.providerId !== input.embedding.providerId ||
		input.text.authMode !== input.embedding.authMode ||
		!sameStringRecord(input.text.settings, input.embedding.settings)
	) {
		throw new Error("Embedding configuration cannot reuse text credentials with a different provider context")
	}
}

function assertDeploymentIdentityEmbedding(input: SaveConfigurationInput): void {
	if (input.embedding.credentialSource !== "deployment-identity") return
	if (input.embedding.authMode !== "deployment-identity") {
		throw new Error("Embedding deployment identity requires deployment-identity authentication")
	}
}

export function validateConfigurationInput(
	input: SaveConfigurationInput,
	existing?: { text?: { credentials: boolean }; embedding?: { credentials: boolean } },
): void {
	assertRole("text", { ...input.text, existingCredentials: existing?.text?.credentials }, true)
	assertRole(
		"embedding",
		{ ...input.embedding, existingCredentials: existing?.embedding?.credentials },
		input.embedding.credentialSource === "separate",
	)
	assertReusedCredentialContext(input)
	assertDeploymentIdentityEmbedding(input)
}
