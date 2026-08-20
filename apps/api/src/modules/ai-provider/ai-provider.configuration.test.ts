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
})
