import { describe, expect, it } from "bun:test"

import { getProviderDefinition } from "./ai-provider.registry.ts"

describe("provider registry", () => {
	it("excludes Anthropic from embedding configuration", () => {
		expect(getProviderDefinition("anthropic").roles).toEqual(["text"])
	})

	it("requires a base URL for OpenAI-compatible endpoints", () => {
		expect(getProviderDefinition("openai-compatible").settingFields).toContain("baseURL")
	})
})
