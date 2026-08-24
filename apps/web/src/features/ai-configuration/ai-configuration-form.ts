import { z } from "zod"

import type {
	AiProviderAuthMode,
	AiProviderConfiguration,
	AiProviderId,
	SaveAiProviderConfigurationInput,
} from "./types.ts"

const roleSchema = z.object({
	providerId: z.enum(["openai", "anthropic", "google", "mistral", "azure", "amazon-bedrock", "openai-compatible"]),
	modelId: z.string().trim().min(1),
	authMode: z.enum(["static", "deployment-identity"]),
	settings: z.record(z.string(), z.string()),
	credentials: z.record(z.string(), z.string()),
})

export const aiConfigurationFormSchema = z.object({
	revision: z.number().int().nonnegative(),
	text: roleSchema,
	embedding: roleSchema.extend({ credentialSource: z.enum(["text", "separate", "deployment-identity"]) }),
})

export type AiConfigurationFormValues = z.infer<typeof aiConfigurationFormSchema>

function emptyRole(providerId: AiProviderId = "openai", authMode: AiProviderAuthMode = "static") {
	return { providerId, modelId: "", authMode, settings: {}, credentials: {} }
}

export function configurationToFormValues(configuration: AiProviderConfiguration): AiConfigurationFormValues {
	return {
		revision: configuration.revision,
		text: configuration.text ? { ...configuration.text, credentials: {} } : emptyRole(),
		embedding: configuration.embedding
			? { ...configuration.embedding, credentials: {} }
			: { ...emptyRole(), credentialSource: "text" },
	}
}

function nonEmpty(values: Record<string, string>): Record<string, string> | undefined {
	const entries = Object.entries(values).filter(([, value]) => value.trim())
	return entries.length ? Object.fromEntries(entries) : undefined
}

function buildRole(role: AiConfigurationFormValues["text"]) {
	const { modelId, providerId, settings } = role
	if (role.authMode === "deployment-identity") {
		return { authMode: "deployment-identity" as const, modelId, providerId, settings }
	}
	const credentials = nonEmpty(role.credentials)
	return { authMode: "static" as const, modelId, providerId, settings, ...(credentials ? { credentials } : {}) }
}

export function buildSaveInput(values: AiConfigurationFormValues): SaveAiProviderConfigurationInput {
	return {
		expectedRevision: values.revision,
		text: buildRole(values.text),
		embedding: { ...buildRole(values.embedding), credentialSource: values.embedding.credentialSource },
	}
}
