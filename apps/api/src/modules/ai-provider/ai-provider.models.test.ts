import { describe, expect, it } from "bun:test"

import { createProviderModel } from "./ai-provider.models.ts"

describe("createProviderModel", () => {
	it.each([
		["openai", { apiKey: "key" }, {}],
		["anthropic", { apiKey: "key" }, {}],
		["google", { apiKey: "key" }, {}],
		["mistral", { apiKey: "key" }, {}],
		["azure", { apiKey: "key" }, { baseURL: "https://example.openai.azure.com/openai" }],
		["amazon-bedrock", { accessKeyId: "access", secretAccessKey: "secret" }, { region: "eu-west-1" }],
		["openai-compatible", { apiKey: "key" }, { baseURL: "http://models.internal/v1" }],
	] as const)("constructs a text model for %s", (providerId, credentials, settings) => {
		const model = createProviderModel({
			providerId,
			role: "text",
			modelId: "model-id",
			authMode: "static",
			settings,
			credentials,
		})

		expect(model.modelId).toBe("model-id")
	})

	it("constructs an embedding model", () => {
		const model = createProviderModel({
			providerId: "openai",
			role: "embedding",
			modelId: "text-embedding-3-small",
			authMode: "static",
			settings: {},
			credentials: { apiKey: "key" },
		})

		expect(model.modelId).toBe("text-embedding-3-small")
	})

	it("rejects Anthropic embeddings", () => {
		expect(() =>
			createProviderModel({
				providerId: "anthropic",
				role: "embedding",
				modelId: "claude-sonnet-4-6",
				authMode: "static",
				settings: {},
				credentials: { apiKey: "key" },
			}),
		).toThrow(/does not support embedding/)
	})
})
