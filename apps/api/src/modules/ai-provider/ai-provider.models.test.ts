import { describe, expect, it } from "bun:test"

import { createProviderModel } from "./ai-provider.models.ts"

describe("createProviderModel", () => {
	it("constructs a text model with provider-specific wiring", () => {
		const model = createProviderModel({
			providerId: "openai",
			role: "text",
			modelId: "model-id",
			authMode: "static",
			settings: {},
			credentials: { apiKey: "key" },
		})

		expect(model.modelId).toBe("model-id")
		expect(model.provider).toBe("openai.responses")
	})

	it("rejects a non-HTTP runtime endpoint", () => {
		expect(() =>
			createProviderModel({
				providerId: "openai-compatible",
				role: "text",
				modelId: "model-id",
				authMode: "static",
				settings: { baseURL: "file:///etc/secrets" },
				credentials: { apiKey: "key" },
			}),
		).toThrow(/HTTP or HTTPS/)
	})
})
