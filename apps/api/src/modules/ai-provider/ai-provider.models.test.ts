import { describe, expect, it } from "bun:test"

import type { AiProviderId, AuthMode } from "./ai-provider.registry.ts"

import { createProviderModel } from "./ai-provider.models.ts"

const credentials = { apiKey: "key", accessKeyId: "access", secretAccessKey: "secret" }

type ModelCase = {
	providerId: AiProviderId
	settings: Record<string, string>
	textProvider: string
	embeddingProvider?: string
}

const modelCases: Array<ModelCase> = [
	{ providerId: "openai", settings: {}, textProvider: "openai.responses", embeddingProvider: "openai.embedding" },
	{ providerId: "anthropic", settings: {}, textProvider: "anthropic.messages" },
	{
		providerId: "google",
		settings: {},
		textProvider: "google.generative-ai",
		embeddingProvider: "google.generative-ai",
	},
	{ providerId: "mistral", settings: {}, textProvider: "mistral.chat", embeddingProvider: "mistral.embedding" },
	{
		providerId: "azure",
		settings: { baseURL: "https://example.openai.azure.com", apiVersion: "2024-06-01" },
		textProvider: "azure.responses",
		embeddingProvider: "azure.embeddings",
	},
	{
		providerId: "amazon-bedrock",
		settings: { region: "eu-central-1" },
		textProvider: "amazon-bedrock",
		embeddingProvider: "amazon-bedrock",
	},
	{
		providerId: "openai-compatible",
		settings: { baseURL: "https://llm.internal/v1" },
		textProvider: "openai-compatible.chat",
		embeddingProvider: "openai-compatible.embedding",
	},
]

const embeddingCases = modelCases.flatMap((entry) =>
	entry.embeddingProvider ? [{ ...entry, embeddingProvider: entry.embeddingProvider }] : [],
)

const deploymentIdentityCases: Array<{ providerId: AiProviderId; settings: Record<string, string> }> = [
	{ providerId: "azure", settings: { baseURL: "https://example.openai.azure.com" } },
	{ providerId: "amazon-bedrock", settings: { region: "eu-central-1" } },
]

function build(
	providerId: AiProviderId,
	role: "text" | "embedding",
	settings: Record<string, string>,
	authMode: AuthMode = "static",
) {
	return createProviderModel({
		providerId,
		role,
		modelId: "model-id",
		authMode,
		settings,
		credentials,
	})
}

describe("createProviderModel", () => {
	it.each(modelCases)(
		"$providerId text models use the $textProvider provider",
		({ providerId, settings, textProvider }) => {
			const model = build(providerId, "text", settings)

			expect(model.provider).toBe(textProvider)
			expect(model.modelId).toBe("model-id")
			expect("doGenerate" in model).toBe(true)
		},
	)

	it.each(embeddingCases)(
		"$providerId embedding models use the $embeddingProvider provider",
		({ providerId, settings, embeddingProvider }) => {
			const model = build(providerId, "embedding", settings)

			expect(model.provider).toBe(embeddingProvider)
			expect(model.modelId).toBe("model-id")
			expect("doEmbed" in model).toBe(true)
		},
	)

	it("rejects a role the provider does not offer", () => {
		expect(() => build("anthropic", "embedding", {})).toThrow("anthropic does not support embedding")
	})

	it("requires a base URL for Azure", () => {
		expect(() => build("azure", "text", {})).toThrow("Azure base URL is required")
	})

	it("requires a base URL for OpenAI-compatible endpoints", () => {
		expect(() => build("openai-compatible", "text", {})).toThrow("OpenAI-compatible base URL is required")
	})

	it("rejects a non-HTTP runtime endpoint", () => {
		expect(() => build("openai-compatible", "text", { baseURL: "file:///etc/secrets" })).toThrow(/HTTP or HTTPS/)
	})

	it.each(deploymentIdentityCases)(
		"builds $providerId models from deployment identity without static credentials",
		({ providerId, settings }) => {
			expect(() =>
				createProviderModel(
					{ providerId, role: "text", modelId: "model-id", authMode: "deployment-identity", settings },
					{ defaultAzureCredential: () => ({ getToken: async () => null }) as never },
				),
			).not.toThrow()
		},
	)
})
