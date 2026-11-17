import { describe, expect, it } from "bun:test"

import { getProviderDefinition } from "./ai-provider.registry.ts"

describe("getProviderDefinition", () => {
	it("returns the declared definition", () => {
		expect(getProviderDefinition("anthropic")).toMatchObject({
			id: "anthropic",
			roles: ["text"],
			authModes: ["static"],
			discovery: true,
		})
	})

	it("fails fast on an unknown provider id", () => {
		expect(() => getProviderDefinition("bogus")).toThrow("Unsupported AI provider: bogus")
	})
})
