import { PROBLEM_CODES } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { describe, expect, it } from "bun:test"

import type { ModelDiscoveryFetch } from "./ai-provider.discovery.ts"

import { discoverModels, ModelDiscoveryError } from "./ai-provider.discovery.ts"

const openAiFetcher: ModelDiscoveryFetch = async () =>
	new Response(JSON.stringify({ data: [{ id: "gpt-5-mini" }, { id: "text-embedding-3-small" }] }))
const googleFetcher: ModelDiscoveryFetch = async () =>
	new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash" }] }))
const unauthorizedFetcher: ModelDiscoveryFetch = async () => new Response("secret provider body", { status: 401 })
const unreachableFetch: ModelDiscoveryFetch = async () => {
	throw new Error("fetch must not be called for unsupported discovery")
}

function fetchUrl(input: string | URL | Request): string {
	if (typeof input === "string") return input
	return input instanceof URL ? input.href : input.url
}

const mistralCases: { expected: string; name: string; settings: Record<string, string> }[] = [
	{
		name: "configured",
		settings: { baseURL: "https://mistral.internal/v1" },
		expected: "https://mistral.internal/v1/models",
	},
	{ name: "default", settings: {}, expected: "https://api.mistral.ai/v1/models" },
]

const staticOpenAi = { providerId: "openai", authMode: "static", settings: {} } as const

const unsupportedDiscoveryCases: {
	name: string
	providerId: "amazon-bedrock" | "azure"
	settings: Record<string, string>
}[] = [
	{ name: "Azure", providerId: "azure", settings: { baseURL: "https://example.openai.azure.com" } },
	{ name: "Amazon Bedrock", providerId: "amazon-bedrock", settings: { region: "eu-central-1" } },
]

describe("discoverModels", () => {
	it("lists OpenAI model identifiers with bearer auth and manual redirects", async () => {
		let seen: { headers: Headers; init: RequestInit | undefined; url: string } | undefined
		const capturing: ModelDiscoveryFetch = async (url, init) => {
			seen = { headers: new Headers(init?.headers), init, url: fetchUrl(url) }
			return openAiFetcher(url, init)
		}

		const result = await discoverModels({ ...staticOpenAi, credentials: { apiKey: "sk-test" } }, capturing)

		expect(result).toEqual(["gpt-5-mini", "text-embedding-3-small"])
		expect(seen?.url).toBe("https://api.openai.com/v1/models")
		expect(seen?.headers.get("authorization")).toBe("Bearer sk-test")
		expect(seen?.init?.redirect).toBe("manual")
		expect(seen?.init?.signal).toBeInstanceOf(AbortSignal)
	})

	it("lists Anthropic models with the API version header", async () => {
		let seen: { headers: Headers; url: string } | undefined
		const capturing: ModelDiscoveryFetch = async (url, init) => {
			seen = { headers: new Headers(init?.headers), url: fetchUrl(url) }
			return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4-6" }] }))
		}

		await discoverModels(
			{ providerId: "anthropic", authMode: "static", settings: {}, credentials: { apiKey: "sk-ant" } },
			capturing,
		)

		expect(seen?.url).toBe("https://api.anthropic.com/v1/models")
		expect(seen?.headers.get("x-api-key")).toBe("sk-ant")
		expect(seen?.headers.get("anthropic-version")).toBe("2023-06-01")
		expect(seen?.headers.get("authorization")).toBeNull()
	})

	it.each(mistralCases)("lists Mistral models from the $name base URL", async ({ settings, expected }) => {
		let requestedUrl = ""
		const fetcher: ModelDiscoveryFetch = async (input) => {
			requestedUrl = fetchUrl(input)
			return new Response(JSON.stringify({ data: [] }))
		}

		await discoverModels(
			{ providerId: "mistral", authMode: "static", settings, credentials: { apiKey: "key" } },
			fetcher,
		)

		expect(requestedUrl).toBe(expected)
	})

	it("normalizes Google model names", async () => {
		const result = await discoverModels(
			{ providerId: "google", authMode: "static", settings: {}, credentials: { apiKey: "key" } },
			googleFetcher,
		)

		expect(result).toEqual(["gemini-2.5-flash"])
	})

	it("sends the Google API key in a header, never in the URL", async () => {
		let seen: { headers: Headers; url: string } | undefined
		const capturing: ModelDiscoveryFetch = async (url, init) => {
			seen = {
				headers: new Headers(init?.headers),
				url: fetchUrl(url),
			}
			return googleFetcher(url, init)
		}

		await discoverModels(
			{ providerId: "google", authMode: "static", settings: {}, credentials: { apiKey: "secret-key" } },
			capturing,
		)

		expect(seen?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models")
		expect(seen?.url).not.toContain("secret-key")
		expect(seen?.headers.get("x-goog-api-key")).toBe("secret-key")
	})

	it("uses the configured OpenAI-compatible base URL", async () => {
		let requestedUrl = ""
		const fetcher: ModelDiscoveryFetch = async (input) => {
			requestedUrl = fetchUrl(input)
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
			requestedUrl = fetchUrl(input)
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
		).rejects.toThrow("Provider base URL must use HTTP or HTTPS")
		expect(requestedUrl).toBe("")
	})

	it("limits streamed provider response bodies by bytes", async () => {
		const oversized = new TextEncoder().encode("x".repeat(1_000_001))
		const fetcher: ModelDiscoveryFetch = async () => new Response(new Blob([oversized]))

		await expect(discoverModels({ ...staticOpenAi, credentials: { apiKey: "sk-test" } }, fetcher)).rejects.toThrow(
			"Provider response is too large",
		)
	})

	it("rejects an oversized body announced by content-length before reading it", async () => {
		await expect(
			discoverModels(
				{ ...staticOpenAi, credentials: { apiKey: "sk-test" } },
				async () => new Response(JSON.stringify({ data: [] }), { headers: { "content-length": "1000001" } }),
			),
		).rejects.toThrow("Provider response is too large")
	})

	it("rejects a body that is not a model list", async () => {
		await expect(
			discoverModels({ ...staticOpenAi, credentials: { apiKey: "sk-test" } }, async () => new Response("not json")),
		).rejects.toThrow("Provider returned an invalid model list")
	})

	it("rejects an empty body as an invalid model list", async () => {
		await expect(
			discoverModels(
				{ ...staticOpenAi, credentials: { apiKey: "sk-test" } },
				async () => new Response(null, { status: 204 }),
			),
		).rejects.toThrow("Provider returned an invalid model list")
	})

	it("requires credentials before contacting the provider", async () => {
		await expect(discoverModels({ ...staticOpenAi }, unreachableFetch)).rejects.toThrow(
			"Provider credentials are required",
		)
	})

	it("requires a base URL for openai-compatible discovery", async () => {
		await expect(
			discoverModels(
				{ providerId: "openai-compatible", authMode: "static", settings: {}, credentials: { apiKey: "key" } },
				unreachableFetch,
			),
		).rejects.toThrow("Provider base URL is required")
	})

	it("returns a stable unauthorized error without provider response details", async () => {
		const pending = discoverModels({ ...staticOpenAi, credentials: { apiKey: "sk-test" } }, unauthorizedFetcher)

		await expect(pending).rejects.toBeInstanceOf(ModelDiscoveryError)
		const error = await pending.catch((cause: unknown) => cause)
		expect((error as ModelDiscoveryError).code).toBe("unauthorized")
		expect((error as Error).message).not.toContain("secret provider body")
	})

	it.each([
		{
			name: "401",
			fetcher: (async () => new Response("", { status: 401 })) as ModelDiscoveryFetch,
			code: "unauthorized",
			problemCode: PROBLEM_CODES.PROVIDER_CREDENTIALS_REJECTED,
			status: HTTP_STATUS.BAD_REQUEST,
		},
		{
			name: "403",
			fetcher: (async () => new Response("", { status: 403 })) as ModelDiscoveryFetch,
			code: "unauthorized",
			problemCode: PROBLEM_CODES.PROVIDER_CREDENTIALS_REJECTED,
			status: HTTP_STATUS.BAD_REQUEST,
		},
		{
			name: "429",
			fetcher: (async () => new Response("", { status: 429 })) as ModelDiscoveryFetch,
			code: "rate-limited",
			problemCode: PROBLEM_CODES.PROVIDER_RATE_LIMITED,
			status: HTTP_STATUS.TOO_MANY_REQUESTS,
		},
		{
			name: "500",
			fetcher: (async () => new Response("", { status: 500 })) as ModelDiscoveryFetch,
			code: "provider-error",
			problemCode: PROBLEM_CODES.PROVIDER_ERROR,
			status: HTTP_STATUS.BAD_GATEWAY,
		},
		{
			name: "network failure",
			fetcher: (async () => {
				throw new Error("ECONNREFUSED")
			}) as ModelDiscoveryFetch,
			code: "unreachable",
			problemCode: PROBLEM_CODES.PROVIDER_UNREACHABLE,
			status: HTTP_STATUS.BAD_GATEWAY,
		},
	])("maps a $name response to a $code problem", async ({ fetcher, code, problemCode, status }) => {
		const error = (await discoverModels({ ...staticOpenAi, credentials: { apiKey: "sk-test" } }, fetcher).catch(
			(cause: unknown) => cause,
		)) as ModelDiscoveryError

		expect(error).toBeInstanceOf(ModelDiscoveryError)
		expect(error.code).toBe(code)
		expect(error.problemCode).toBe(problemCode)
		expect(error.status).toBe(status)
	})

	it.each(unsupportedDiscoveryCases)("reports unsupported discovery for $name", async ({ providerId, settings }) => {
		const error = (await discoverModels(
			{ providerId, authMode: "static", settings, credentials: { apiKey: "key" } },
			unreachableFetch,
		).catch((cause: unknown) => cause)) as ModelDiscoveryError

		expect(error.code).toBe("unsupported")
		expect(error.problemCode).toBe(PROBLEM_CODES.MODEL_DISCOVERY_UNSUPPORTED)
		expect(error.status).toBe(HTTP_STATUS.BAD_GATEWAY)
	})

	it("reports unsupported discovery for deployment identity", async () => {
		await expect(
			discoverModels({ providerId: "openai", authMode: "deployment-identity", settings: {} }, unreachableFetch),
		).rejects.toMatchObject({ code: "unsupported" })
	})
})
