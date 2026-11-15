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
import { assertHttpBaseUrl } from "./base-url.ts"

type ModelConfiguration = {
	authMode: AuthMode
	credentials?: Record<string, string>
	modelId: string
	providerId: AiProviderId
	role: AiProviderRole
	settings: Record<string, string>
}

type ModelBuilderContext = {
	baseUrl?: string
	configuration: ModelConfiguration
	credentials: Record<string, string>
	defaultAzureCredential: () => DefaultAzureCredential
}

let defaultAzureCredential: DefaultAzureCredential | undefined

function azureTokenProvider(credentialFactory: () => DefaultAzureCredential): () => Promise<string> {
	const credential = credentialFactory()
	return async () => {
		const token = await credential.getToken("https://cognitiveservices.azure.com/.default")
		if (!token) throw new Error("Azure deployment identity did not provide an access token")
		return token.token
	}
}

function selectModel(
	configuration: ModelConfiguration,
	textModel: () => LanguageModelV4,
	embeddingModel: () => EmbeddingModelV4,
): LanguageModelV4 | EmbeddingModelV4 {
	return configuration.role === "text" ? textModel() : embeddingModel()
}

function openAiModel({ configuration, credentials }: ModelBuilderContext): LanguageModelV4 | EmbeddingModelV4 {
	const provider = createOpenAI({ apiKey: credentials.apiKey, project: configuration.settings.project })
	return selectModel(
		configuration,
		() => provider(configuration.modelId),
		() => provider.embedding(configuration.modelId),
	)
}

function anthropicModel({ configuration, credentials }: ModelBuilderContext): LanguageModelV4 {
	return createAnthropic({ apiKey: credentials.apiKey })(configuration.modelId)
}

function googleModel({ configuration, credentials }: ModelBuilderContext): LanguageModelV4 | EmbeddingModelV4 {
	const provider = createGoogle({ apiKey: credentials.apiKey })
	return selectModel(
		configuration,
		() => provider(configuration.modelId),
		() => provider.embedding(configuration.modelId),
	)
}

function mistralModel({
	configuration,
	credentials,
	baseUrl,
}: ModelBuilderContext): LanguageModelV4 | EmbeddingModelV4 {
	const provider = createMistral({ apiKey: credentials.apiKey, baseURL: baseUrl })
	return selectModel(
		configuration,
		() => provider(configuration.modelId),
		() => provider.embedding(configuration.modelId),
	)
}

function azureModel({
	configuration,
	credentials,
	baseUrl,
	defaultAzureCredential: credentialFactory,
}: ModelBuilderContext): LanguageModelV4 | EmbeddingModelV4 {
	if (!baseUrl) throw new Error("Azure base URL is required")
	const provider = createAzure({
		baseURL: baseUrl,
		apiVersion: configuration.settings.apiVersion,
		...(configuration.authMode === "static"
			? { apiKey: credentials.apiKey }
			: { tokenProvider: azureTokenProvider(credentialFactory) }),
	})
	return selectModel(
		configuration,
		() => provider(configuration.modelId),
		() => provider.embedding(configuration.modelId),
	)
}

function bedrockModel({ configuration, credentials }: ModelBuilderContext): LanguageModelV4 | EmbeddingModelV4 {
	const provider = createAmazonBedrock({
		region: configuration.settings.region,
		...(configuration.authMode === "static"
			? {
					accessKeyId: credentials.accessKeyId,
					secretAccessKey: credentials.secretAccessKey,
					sessionToken: credentials.sessionToken,
				}
			: {}),
	})
	return selectModel(
		configuration,
		() => provider(configuration.modelId),
		() => provider.embedding(configuration.modelId),
	)
}

function openAiCompatibleModel({
	configuration,
	credentials,
	baseUrl,
}: ModelBuilderContext): LanguageModelV4 | EmbeddingModelV4 {
	if (!baseUrl) throw new Error("OpenAI-compatible base URL is required")
	const provider = createOpenAICompatible({
		name: "openai-compatible",
		baseURL: baseUrl,
		apiKey: credentials.apiKey,
	})
	return selectModel(
		configuration,
		() => provider(configuration.modelId),
		() => provider.embeddingModel(configuration.modelId),
	)
}

const MODEL_BUILDERS: Record<AiProviderId, (context: ModelBuilderContext) => LanguageModelV4 | EmbeddingModelV4> = {
	openai: openAiModel,
	anthropic: anthropicModel,
	google: googleModel,
	mistral: mistralModel,
	azure: azureModel,
	"amazon-bedrock": bedrockModel,
	"openai-compatible": openAiCompatibleModel,
}

export function createProviderModel(
	configuration: ModelConfiguration,
	dependencies: { defaultAzureCredential: () => DefaultAzureCredential } = {
		defaultAzureCredential: () => (defaultAzureCredential ??= new DefaultAzureCredential()),
	},
): LanguageModelV4 | EmbeddingModelV4 {
	const definition = getProviderDefinition(configuration.providerId)
	if (!definition.roles.includes(configuration.role)) {
		throw new Error(`${configuration.providerId} does not support ${configuration.role}`)
	}

	const configuredBaseUrl = configuration.settings.baseURL
	return MODEL_BUILDERS[configuration.providerId]({
		configuration,
		credentials: configuration.credentials ?? {},
		baseUrl: configuredBaseUrl ? assertHttpBaseUrl(configuredBaseUrl).toString() : undefined,
		defaultAzureCredential: dependencies.defaultAzureCredential,
	})
}
