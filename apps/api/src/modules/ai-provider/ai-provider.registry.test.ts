import { describe, expect, it } from "bun:test"

import { getProviderDefinition, PROVIDER_DEFINITIONS } from "./ai-provider.registry.ts"

describe("provider registry", () => {
	it("contains the seven approved providers", () => {
		expect(PROVIDER_DEFINITIONS.map((provider) => provider.id)).toEqual([
			"openai",
			"anthropic",
			"google",
			"mistral",
			"azure",
			"amazon-bedrock",
			"openai-compatible",
		])
	})

	it("excludes Anthropic from embedding configuration", () => {
		expect(getProviderDefinition("anthropic").roles).toEqual(["text"])
	})

	it("requires a base URL for OpenAI-compatible endpoints", () => {
		expect(getProviderDefinition("openai-compatible").settingFields).toContain("baseURL")
	})

	it("rejects unknown provider identifiers", () => {
		expect(() => getProviderDefinition("unknown")).toThrow(/Unsupported AI provider/)
	})
})
