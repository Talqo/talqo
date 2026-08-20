import { describe, expect, it } from "bun:test"

import type { ModelDiscoveryFetch } from "./ai-provider.discovery.ts"

import { discoverModels, ModelDiscoveryError } from "./ai-provider.discovery.ts"

const openAiFetcher: ModelDiscoveryFetch = async () =>
	new Response(JSON.stringify({ data: [{ id: "gpt-5-mini" }, { id: "text-embedding-3-small" }] }))
const googleFetcher: ModelDiscoveryFetch = async () =>
	new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash" }] }))
const unauthorizedFetcher: ModelDiscoveryFetch = async () => new Response("secret provider body", { status: 401 })

describe("discoverModels", () => {
	it("returns OpenAI model identifiers without classifying them", async () => {
		const result = await discoverModels(
			{ providerId: "openai", authMode: "static", settings: {}, credentials: { apiKey: "sk-test" } },
			openAiFetcher,
		)

		expect(result).toEqual(["gpt-5-mini", "text-embedding-3-small"])
	})

	it("normalizes Google model names", async () => {
		const result = await discoverModels(
			{ providerId: "google", authMode: "static", settings: {}, credentials: { apiKey: "key" } },
			googleFetcher,
		)

		expect(result).toEqual(["gemini-2.5-flash"])
	})

	it("uses the configured OpenAI-compatible base URL", async () => {
		let requestedUrl = ""
		const fetcher: ModelDiscoveryFetch = async (input) => {
			requestedUrl = String(input)
			return new Response(JSON.stringify({ data: [] }))
		}

		await discoverModels(
			{
				providerId: "openai-compatible",
				authMode: "static",
				settings: { baseURL: "http://models.internal/v1/" },
				credentials: { apiKey: "local" },
			},
			fetcher,
		)

		expect(requestedUrl).toBe("http://models.internal/v1/models")
	})

	it("rejects a non-HTTP provider endpoint before sending credentials", async () => {
		let requestedUrl = ""
		const fetcher: ModelDiscoveryFetch = async (input) => {
			requestedUrl = String(input)
			return new Response(JSON.stringify({ data: [] }))
		}

		await expect(
			discoverModels(
				{
					providerId: "openai-compatible",
					authMode: "static",
					settings: { baseURL: "file:///etc/secrets" },
					credentials: { apiKey: "sk-sent" },
				},
				fetcher,
			),
		).rejects.toMatchObject({ code: "provider-error" })
		expect(requestedUrl).toBe("")
	})

	it("limits streamed provider response bodies by bytes", async () => {
		const oversized = new TextEncoder().encode("x".repeat(1_000_001))
		const fetcher: ModelDiscoveryFetch = async () => new Response(new Blob([oversized]))

		await expect(
			discoverModels(
				{ providerId: "openai", authMode: "static", settings: {}, credentials: { apiKey: "sk-test" } },
				fetcher,
			),
		).rejects.toMatchObject({ code: "provider-error" })
	})

	it("returns a stable unauthorized error without provider response details", async () => {
		try {
			await discoverModels(
				{ providerId: "openai", authMode: "static", settings: {}, credentials: { apiKey: "sk-test" } },
				unauthorizedFetcher,
			)
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(ModelDiscoveryError)
			expect((error as ModelDiscoveryError).code).toBe("unauthorized")
			expect((error as Error).message).not.toContain("secret provider body")
		}
	})

	it("reports unsupported discovery for Azure", async () => {
		await expect(
			discoverModels(
				{
					providerId: "azure",
					authMode: "static",
					settings: { baseURL: "https://example.openai.azure.com" },
					credentials: { apiKey: "key" },
				},
				fetch,
			),
		).rejects.toMatchObject({ code: "unsupported" })
	})
})
