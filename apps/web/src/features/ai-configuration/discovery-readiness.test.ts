import { describe, expect, it } from "bun:test"

import type { ProviderMetadata } from "./types.ts"

import {
	hasCompleteCredentials,
	isDiscoveryReady,
	requiredCredentials,
	storedCredentialsMatch,
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

const multiField: ProviderMetadata = {
	id: "amazon-bedrock",
	roles: ["text", "embedding"],
	authModes: ["static"],
	settingFields: ["region", "endpoint"],
	requiredSettingFields: ["region", "endpoint"],
	credentialFields: ["accessKeyId", "secretAccessKey"],
	requiredCredentialFields: ["accessKeyId", "secretAccessKey"],
	discovery: true,
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

	it("matches reordered Azure settings only to stored credentials for the same provider and auth mode", () => {
		const stored = {
			providerId: "azure",
			modelId: "x",
			authMode: "static",
			settings: { apiVersion: "2026-01-01", baseURL: "http://models.internal" },
			hasCredentials: true,
		} as const
		const value = {
			authMode: "static",
			settings: { baseURL: "http://models.internal", apiVersion: "2026-01-01" },
			credentials: {},
		} as const

		expect(storedCredentialsMatch({ provider: azure, value, stored })).toBe(true)
		expect(
			storedCredentialsMatch({
				provider: azure,
				value: { ...value, settings: stored.settings },
				stored: { ...stored, settings: value.settings },
			}),
		).toBe(true)
		expect(
			storedCredentialsMatch({ provider: azure, value, stored: { ...stored, providerId: "openai-compatible" } }),
		).toBe(false)
		expect(
			storedCredentialsMatch({
				provider: azure,
				value,
				stored: { ...stored, authMode: "deployment-identity" },
			}),
		).toBe(false)
	})

	it("omits a blank discovery key instead of sending it with unrelated credential fields", () => {
		expect(requiredCredentials(openAiCompatible, { apiKey: " \t ", accessKeyId: "extra" })).toEqual({})
		expect(requiredCredentials(openAiCompatible, { apiKey: "key", accessKeyId: "extra" })).toEqual({ apiKey: "key" })
	})

	it("skips providers without discovery support", () => {
		expect(
			isDiscoveryReady({
				provider: azure,
				value: {
					authMode: "static",
					settings: { baseURL: "https://azure.example.com", apiVersion: "2026-01-01" },
					credentials: { apiKey: "key" },
				},
				stored: null,
			}),
		).toBe(false)
		expect(supportsDiscovery(azure, "static")).toBe(false)
		expect(supportsDiscovery(azure, "deployment-identity")).toBe(false)
		expect(supportsDiscovery(openAiCompatible, "deployment-identity")).toBe(false)
	})

	it("keeps only complete required credentials in the discovery signature", () => {
		expect(requiredCredentials(azure, { apiKey: "key", accessKeyId: "extra" })).toEqual({ apiKey: "key" })
		expect(hasCompleteCredentials(openAiCompatible, { apiKey: "" })).toBe(false)
	})

	it("requires every required setting and credential on multi-field providers", () => {
		expect(hasCompleteCredentials(multiField, { accessKeyId: "id" })).toBe(false)
		expect(hasCompleteCredentials(multiField, { accessKeyId: "id", secretAccessKey: " \t " })).toBe(false)
		expect(hasCompleteCredentials(multiField, { accessKeyId: "id", secretAccessKey: "secret" })).toBe(true)

		const credentials = { accessKeyId: "id", secretAccessKey: "secret" }
		expect(
			isDiscoveryReady({
				provider: multiField,
				value: { authMode: "static", settings: { region: "us-east-1" }, credentials },
				stored: null,
			}),
		).toBe(false)
		expect(
			isDiscoveryReady({
				provider: multiField,
				value: {
					authMode: "static",
					settings: { region: " \t ", endpoint: "https://bedrock.example" },
					credentials,
				},
				stored: null,
			}),
		).toBe(false)
		expect(
			isDiscoveryReady({
				provider: multiField,
				value: {
					authMode: "static",
					settings: { region: "us-east-1", endpoint: "https://bedrock.example" },
					credentials,
				},
				stored: null,
			}),
		).toBe(true)
	})
})
