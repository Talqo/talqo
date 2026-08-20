import type { SaveConfigurationInput } from "./ai-provider.contract.ts"

import { getProviderDefinition } from "./ai-provider.registry.ts"

function assertNonEmptyFields(
	values: Record<string, string> | undefined,
	fields: readonly string[],
	label: string,
): void {
	for (const field of fields) {
		if (!values?.[field]?.trim()) throw new Error(`${label} are required: ${field}`)
	}
}

function assertRole(
	role: "text" | "embedding",
	input: SaveConfigurationInput["text"] | SaveConfigurationInput["embedding"],
	expectedRevision: number,
	requireStaticCredentials: boolean,
): void {
	const provider = getProviderDefinition(input.providerId)
	if (!provider.roles.includes(role)) throw new Error(`${input.providerId} does not support ${role}`)
	if (!provider.authModes.includes(input.authMode)) {
		throw new Error(`${input.providerId} does not support ${input.authMode} authentication`)
	}
	assertNonEmptyFields(input.settings, provider.requiredSettingFields, `${input.providerId} setting`)
	if (requireStaticCredentials && input.authMode === "static" && expectedRevision === 0) {
		assertNonEmptyFields(input.credentials, provider.requiredCredentialFields, `${input.providerId} credentials`)
	}
}

function sameRecord(left: Record<string, string>, right: Record<string, string>): boolean {
	const leftEntries = Object.entries(left).toSorted(([a], [b]) => a.localeCompare(b))
	const rightEntries = Object.entries(right).toSorted(([a], [b]) => a.localeCompare(b))
	return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

export function validateConfigurationInput(input: SaveConfigurationInput): void {
	assertRole("text", input.text, input.expectedRevision, true)
	assertRole("embedding", input.embedding, input.expectedRevision, input.embedding.credentialSource === "separate")

	if (input.embedding.credentialSource === "text") {
		if (
			input.text.providerId !== input.embedding.providerId ||
			input.text.authMode !== input.embedding.authMode ||
			!sameRecord(input.text.settings, input.embedding.settings)
		) {
			throw new Error("Embedding configuration cannot reuse text credentials with a different provider context")
		}
	}

	if (
		input.embedding.credentialSource === "deployment-identity" &&
		input.embedding.authMode !== "deployment-identity"
	) {
		throw new Error("Embedding deployment identity requires deployment-identity authentication")
	}

	if (input.embedding.credentialSource === "separate" && input.embedding.authMode === "static") {
		const provider = getProviderDefinition(input.embedding.providerId)
		if (input.expectedRevision === 0) {
			assertNonEmptyFields(
				input.embedding.credentials,
				provider.requiredCredentialFields,
				`${input.embedding.providerId} credentials`,
			)
		}
	}
}
