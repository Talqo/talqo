import { describe, expect, it } from "bun:test"

import { validateConfigurationInput } from "./ai-provider.configuration.ts"

const text = {
	providerId: "openai" as const,
	modelId: "gpt-5-mini",
	authMode: "static" as const,
	settings: {},
	credentials: { apiKey: "sk-text" },
}

describe("validateConfigurationInput", () => {
	it("accepts embedding credentials reused from a compatible text provider", () => {
		expect(() =>
			validateConfigurationInput({
				expectedRevision: 0,
				text,
				embedding: {
					providerId: "openai",
					modelId: "text-embedding-3-small",
					authMode: "static",
					settings: {},
					credentialSource: "text",
				},
			}),
		).not.toThrow()
	})

	it("rejects a provider without embedding support", () => {
		expect(() =>
			validateConfigurationInput({
				expectedRevision: 0,
				text,
				embedding: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
					authMode: "static",
					settings: {},
					credentialSource: "separate",
					credentials: { apiKey: "sk-embed" },
				},
			}),
		).toThrow(/does not support embedding/)
	})

	it("rejects text credential reuse across providers", () => {
		expect(() =>
			validateConfigurationInput({
				expectedRevision: 0,
				text,
				embedding: {
					providerId: "mistral",
					modelId: "mistral-embed",
					authMode: "static",
					settings: {},
					credentialSource: "text",
				},
			}),
		).toThrow(/reuse text credentials/)
	})

	it("requires static credentials for a new configuration", () => {
		expect(() =>
			validateConfigurationInput({
				expectedRevision: 0,
				text: { ...text, credentials: undefined },
				embedding: {
					providerId: "openai",
					modelId: "text-embedding-3-small",
					authMode: "static",
					settings: {},
					credentialSource: "text",
				},
			}),
		).toThrow(/credentials are required/)
	})

	it("rejects undeclared plaintext settings", () => {
		expect(() =>
			validateConfigurationInput({
				expectedRevision: 1,
				text: { ...text, settings: { apiKey: "sk-inline-secret" }, credentials: { apiKey: "sk-text" } },
				embedding: {
					providerId: "openai",
					modelId: "text-embedding-3-small",
					authMode: "static",
					settings: {},
					credentialSource: "text",
				},
			}),
		).toThrow(/unsupported settings|does not support setting/)
	})

	it("rejects credentials that are only whitespace", () => {
		expect(() =>
			validateConfigurationInput({
				expectedRevision: 0,
				text: { ...text, credentials: { apiKey: "   " } },
				embedding: {
					providerId: "openai",
					modelId: "text-embedding-3-small",
					authMode: "static",
					settings: {},
					credentialSource: "text",
				},
			}),
		).toThrow("openai credentials are required: apiKey")
	})

	it("rejects a base URL that is not HTTP or HTTPS", () => {
		expect(() =>
			validateConfigurationInput({
				expectedRevision: 0,
				text: { ...text, providerId: "mistral", settings: { baseURL: "file:///etc/secrets" } },
				embedding: {
					providerId: "openai",
					modelId: "text-embedding-3-small",
					authMode: "static",
					settings: {},
					credentialSource: "text",
				},
			}),
		).toThrow("Provider base URL must use HTTP or HTTPS")
	})

	it("rejects an authentication mode the provider does not offer", () => {
		expect(() =>
			validateConfigurationInput({
				expectedRevision: 0,
				text: { ...text, authMode: "deployment-identity" },
				embedding: {
					providerId: "openai",
					modelId: "text-embedding-3-small",
					authMode: "static",
					settings: {},
					credentialSource: "text",
				},
			}),
		).toThrow("openai does not support deployment-identity authentication")
	})

	it("rejects reusing text credentials under different provider settings", () => {
		expect(() =>
			validateConfigurationInput({
				expectedRevision: 0,
				text: { ...text, providerId: "mistral", settings: { baseURL: "https://api.mistral.ai/v1" } },
				embedding: {
					providerId: "mistral",
					modelId: "mistral-embed",
					authMode: "static",
					settings: { baseURL: "https://eu.api.mistral.ai/v1" },
					credentialSource: "text",
				},
			}),
		).toThrow(/reuse text credentials/)
	})

	it("rejects a deployment-identity embedding source without deployment-identity authentication", () => {
		expect(() =>
			validateConfigurationInput({
				expectedRevision: 0,
				text,
				embedding: {
					providerId: "openai",
					modelId: "text-embedding-3-small",
					authMode: "static",
					settings: {},
					credentialSource: "deployment-identity",
				},
			}),
		).toThrow("Embedding deployment identity requires deployment-identity authentication")
	})

	it("accepts a save that keeps already stored static credentials", () => {
		expect(() =>
			validateConfigurationInput(
				{
					expectedRevision: 1,
					text: { ...text, credentials: undefined },
					embedding: {
						providerId: "openai",
						modelId: "text-embedding-3-small",
						authMode: "static",
						settings: {},
						credentialSource: "text",
					},
				},
				{ text: { credentials: true }, embedding: { credentials: true } },
			),
		).not.toThrow()
	})
})
