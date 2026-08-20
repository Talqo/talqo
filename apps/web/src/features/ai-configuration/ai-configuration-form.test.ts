import { describe, expect, it } from "bun:test"

import { buildSaveInput, configurationToFormValues } from "./ai-configuration-form.ts"

describe("AI configuration form mapping", () => {
	it("maps an unconfigured deployment to required empty roles", () => {
		const values = configurationToFormValues({
			revision: 0,
			health: "unconfigured",
			text: null,
			embedding: null,
		})

		expect(values.text.providerId).toBe("openai")
		expect(values.embedding.credentialSource).toBe("text")
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

		expect(input.text.credentials).toBeUndefined()
		expect(input.embedding.credentials).toBeUndefined()
	})
})
