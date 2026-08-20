import type { EmbeddingModelV4, LanguageModelV4 } from "@ai-sdk/provider"

import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createGoogle } from "@ai-sdk/google"
import { createMistral } from "@ai-sdk/mistral"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { DefaultAzureCredential } from "@azure/identity"

import type { AiProviderId, AiProviderRole, AuthMode } from "./ai-provider.registry.ts"

import { getProviderDefinition } from "./ai-provider.registry.ts"

type ModelConfiguration = {
	authMode: AuthMode
	credentials?: Record<string, string>
	modelId: string
	providerId: AiProviderId
	role: AiProviderRole
	settings: Record<string, string>
}

function azureTokenProvider(): () => Promise<string> {
	const credential = new DefaultAzureCredential()
	return async () => {
		const token = await credential.getToken("https://cognitiveservices.azure.com/.default")
		if (!token) throw new Error("Azure deployment identity did not provide an access token")
		return token.token
	}
}

export function createProviderModel(configuration: ModelConfiguration): LanguageModelV4 | EmbeddingModelV4 {
	const definition = getProviderDefinition(configuration.providerId)
	if (!definition.roles.includes(configuration.role)) {
		throw new Error(`${configuration.providerId} does not support ${configuration.role}`)
	}

	const credentials = configuration.credentials ?? {}
	let provider
	switch (configuration.providerId) {
		case "openai":
			provider = createOpenAI({ apiKey: credentials.apiKey, project: configuration.settings.project })
			return configuration.role === "text" ? provider(configuration.modelId) : provider.embedding(configuration.modelId)
		case "anthropic":
			return createAnthropic({ apiKey: credentials.apiKey })(configuration.modelId)
		case "google":
			provider = createGoogle({ apiKey: credentials.apiKey })
			return configuration.role === "text" ? provider(configuration.modelId) : provider.embedding(configuration.modelId)
		case "mistral":
			provider = createMistral({ apiKey: credentials.apiKey, baseURL: configuration.settings.baseURL })
			return configuration.role === "text" ? provider(configuration.modelId) : provider.embedding(configuration.modelId)
		case "azure":
			provider = createAzure({
				baseURL: configuration.settings.baseURL,
				apiVersion: configuration.settings.apiVersion,
				...(configuration.authMode === "static"
					? { apiKey: credentials.apiKey }
					: { tokenProvider: azureTokenProvider() }),
			})
			return configuration.role === "text" ? provider(configuration.modelId) : provider.embedding(configuration.modelId)
		case "amazon-bedrock":
			provider = createAmazonBedrock({
				region: configuration.settings.region,
				...(configuration.authMode === "static"
					? {
							accessKeyId: credentials.accessKeyId,
							secretAccessKey: credentials.secretAccessKey,
							sessionToken: credentials.sessionToken,
						}
					: {}),
			})
			return configuration.role === "text" ? provider(configuration.modelId) : provider.embedding(configuration.modelId)
		case "openai-compatible":
			provider = createOpenAICompatible({
				name: "openai-compatible",
				baseURL: configuration.settings.baseURL ?? "",
				apiKey: credentials.apiKey,
			})
			return configuration.role === "text"
				? provider(configuration.modelId)
				: provider.embeddingModel(configuration.modelId)
	}
}
