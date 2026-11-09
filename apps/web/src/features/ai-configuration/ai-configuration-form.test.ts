import { describe, expect, it } from "bun:test"

import { aiConfigurationFormSchema, buildSaveInput, configurationToFormValues } from "./ai-configuration-form.ts"

describe("AI configuration form mapping", () => {
	it("maps an unconfigured deployment to empty roles that share text credentials", () => {
		const values = configurationToFormValues({
			revision: 0,
			health: "unconfigured",
			text: null,
			embedding: null,
		})

		expect(values.text.modelId).toBe("")
		expect(values.text).toMatchObject({ providerId: "openai", authMode: "static" })
		expect(values.embedding.modelId).toBe("")
		expect(values.embedding).toMatchObject({ providerId: "openai", authMode: "static" })
		expect(values.embedding.credentialSource).toBe("text")
	})

	it("keeps credentials when a later credential field is filled", () => {
		const input = buildSaveInput({
			revision: 2,
			text: {
				providerId: "openai",
				modelId: "gpt-5-mini",
				authMode: "static",
				settings: {},
				credentials: { apiKey: "sk-form" },
			},
			embedding: {
				providerId: "openai",
				modelId: "text-embedding-3-small",
				authMode: "static",
				settings: {},
				credentials: { apiKey: "" },
				credentialSource: "text",
			},
		})

		expect(input.text).toMatchObject({ credentials: { apiKey: "sk-form" } })
		expect(input.embedding).not.toHaveProperty("credentials")
	})

	it("treats whitespace-only credentials as empty", () => {
		const input = buildSaveInput({
			revision: 2,
			text: {
				providerId: "openai",
				modelId: "gpt-5-mini",
				authMode: "static",
				settings: {},
				credentials: { apiKey: "   " },
			},
			embedding: {
				providerId: "openai",
				modelId: "text-embedding-3-small",
				authMode: "static",
				settings: {},
				credentials: {},
				credentialSource: "text",
			},
		})

		expect(input.text).not.toHaveProperty("credentials")
	})

	it("accepts every provider and credential source while rejecting blank models", () => {
		const role = {
			providerId: "openai",
			modelId: "gpt-5-mini",
			authMode: "static",
			settings: {},
			credentials: {},
		} as const
		const valid = { revision: 0, text: role, embedding: { ...role, credentialSource: "text" } } as const

		for (const providerId of [
			"openai",
			"anthropic",
			"google",
			"mistral",
			"azure",
			"amazon-bedrock",
			"openai-compatible",
		] as const) {
			expect(aiConfigurationFormSchema.safeParse({ ...valid, text: { ...role, providerId } }).success).toBe(true)
		}
		for (const credentialSource of ["text", "separate", "deployment-identity"] as const) {
			expect(aiConfigurationFormSchema.safeParse({ ...valid, embedding: { ...role, credentialSource } }).success).toBe(
				true,
			)
		}
		expect(aiConfigurationFormSchema.safeParse({ ...valid, text: { ...role, modelId: "   " } }).success).toBe(false)
	})

	it("omits empty credential fields when preserving stored credentials", () => {
		const input = buildSaveInput({
			revision: 2,
			text: {
				providerId: "openai",
				modelId: "gpt-5-mini",
				authMode: "static",
				settings: {},
				credentials: { apiKey: "" },
			},
			embedding: {
				providerId: "openai",
				modelId: "text-embedding-3-small",
				authMode: "static",
				settings: {},
				credentials: {},
				credentialSource: "text",
			},
		})

		expect(input.text).not.toHaveProperty("credentials")
		expect(input.embedding).not.toHaveProperty("credentials")
	})

	it("drops credentials for deployment-identity roles", () => {
		const input = buildSaveInput({
			revision: 0,
			text: {
				providerId: "azure",
				modelId: "gpt-5",
				authMode: "deployment-identity",
				settings: { baseURL: "https://example.openai.azure.com" },
				credentials: { apiKey: "sk-form" },
			},
			embedding: {
				providerId: "openai",
				modelId: "text-embedding-3-small",
				authMode: "static",
				settings: {},
				credentials: { apiKey: "sk-embedding" },
				credentialSource: "separate",
			},
		})

		expect(input.text).not.toHaveProperty("credentials")
		expect(input.text.authMode).toBe("deployment-identity")
		expect(input.embedding).toMatchObject({ credentials: { apiKey: "sk-embedding" } })
	})
})
