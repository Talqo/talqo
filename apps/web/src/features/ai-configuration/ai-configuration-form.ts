import type {
	AiProviderConfiguration,
	AiProviderId,
	AiProviderAuthMode,
	SaveAiProviderConfigurationInput,
} from "@/api/client.ts"

import { z } from "zod"

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

export function buildSaveInput(values: AiConfigurationFormValues): SaveAiProviderConfigurationInput {
	return {
		expectedRevision: values.revision,
		text: { ...values.text, credentials: nonEmpty(values.text.credentials) },
		embedding: { ...values.embedding, credentials: nonEmpty(values.embedding.credentials) },
	}
}
