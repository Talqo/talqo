import { describe, expect, it } from "bun:test"

import type { ProviderMetadata } from "./types.ts"

import {
	hasCompleteCredentials,
	isDiscoveryReady,
	requiredCredentials,
	supportsDiscovery,
} from "./discovery-readiness.ts"

const openAiCompatible: ProviderMetadata = {
	id: "openai-compatible",
	roles: ["text", "embedding"],
	authModes: ["static"],
	settingFields: ["baseURL"],
	requiredSettingFields: ["baseURL"],
	credentialFields: ["apiKey"],
	requiredCredentialFields: ["apiKey"],
	discovery: true,
}

const azure: ProviderMetadata = {
	id: "azure",
	roles: ["text", "embedding"],
	authModes: ["static", "deployment-identity"],
	settingFields: ["baseURL", "apiVersion"],
	requiredSettingFields: ["baseURL"],
	credentialFields: ["apiKey"],
	requiredCredentialFields: ["apiKey"],
	discovery: false,
}

describe("discovery readiness", () => {
	it("requires a base URL and API key before contacting an OpenAI-compatible endpoint", () => {
		expect(
			isDiscoveryReady({
				provider: openAiCompatible,
				value: { authMode: "static", settings: { baseURL: "" }, credentials: { apiKey: "key" } },
				stored: null,
			}),
		).toBe(false)
		expect(
			isDiscoveryReady({
				provider: openAiCompatible,
				value: { authMode: "static", settings: { baseURL: "http://models.internal" }, credentials: { apiKey: "" } },
				stored: null,
			}),
		).toBe(false)
		expect(
			isDiscoveryReady({
				provider: openAiCompatible,
				value: { authMode: "static", settings: { baseURL: "http://models.internal" }, credentials: { apiKey: "key" } },
				stored: null,
			}),
		).toBe(true)
	})

	it("is ready with matching stored credentials and no typed secrets", () => {
		expect(
			isDiscoveryReady({
				provider: openAiCompatible,
				value: { authMode: "static", settings: { baseURL: "http://models.internal" }, credentials: {} },
				stored: {
					providerId: "openai-compatible",
					modelId: "x",
					authMode: "static",
					settings: { baseURL: "http://models.internal" },
					hasCredentials: true,
				},
			}),
		).toBe(true)
	})

	it("does not reuse stored credentials after the connection context changes", () => {
		expect(
			isDiscoveryReady({
				provider: openAiCompatible,
				value: { authMode: "static", settings: { baseURL: "http://other.internal" }, credentials: {} },
				stored: {
					providerId: "openai-compatible",
					modelId: "x",
					authMode: "static",
					settings: { baseURL: "http://models.internal" },
					hasCredentials: true,
				},
			}),
		).toBe(false)
	})

	it("skips providers without discovery support", () => {
		expect(supportsDiscovery(azure, "static")).toBe(false)
		expect(supportsDiscovery(azure, "deployment-identity")).toBe(false)
		expect(supportsDiscovery(openAiCompatible, "deployment-identity")).toBe(false)
	})

	it("keeps only complete required credentials in the discovery signature", () => {
		expect(requiredCredentials(azure, { apiKey: "key", accessKeyId: "extra" })).toEqual({ apiKey: "key" })
		expect(hasCompleteCredentials(openAiCompatible, { apiKey: "" })).toBe(false)
	})

	it("reports complete credentials when the provider requires none", () => {
		const keyless: ProviderMetadata = { ...openAiCompatible, credentialFields: [], requiredCredentialFields: [] }

		expect(hasCompleteCredentials(keyless, {})).toBe(true)
	})
})
