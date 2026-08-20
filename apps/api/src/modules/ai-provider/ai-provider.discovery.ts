import { HTTP_STATUS } from "@/http/status.ts"
import { z } from "zod"

import type { DiscoverModelsInput } from "./ai-provider.contract.ts"

import { assertHttpBaseUrl } from "./endpoint-policy.ts"

const MAX_RESPONSE_BYTES = 1_000_000
const DISCOVERY_TIMEOUT_MS = 10_000

export type ModelDiscoveryFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type ModelDiscoveryErrorCode = "unauthorized" | "unreachable" | "rate-limited" | "unsupported" | "provider-error"

export class ModelDiscoveryError extends Error {
	constructor(
		readonly code: ModelDiscoveryErrorCode,
		message: string,
	) {
		super(message)
	}
}

const openAiResponseSchema = z.object({ data: z.array(z.object({ id: z.string() })) })
const googleResponseSchema = z.object({ models: z.array(z.object({ name: z.string() })) })

function modelsUrl(baseURL: string): string {
	return `${baseURL.replace(/\/$/, "")}/models`
}

async function fetchJson(url: string, headers: Record<string, string>, fetcher: ModelDiscoveryFetch): Promise<unknown> {
	let response: Response
	try {
		response = await fetcher(url, {
			headers,
			redirect: "manual",
			signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
		})
	} catch {
		throw new ModelDiscoveryError("unreachable", "Provider could not be reached")
	}

	if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN) {
		throw new ModelDiscoveryError("unauthorized", "Provider rejected the configured credentials")
	}
	if (response.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
		throw new ModelDiscoveryError("rate-limited", "Provider rate limit reached")
	}
	if (!response.ok) throw new ModelDiscoveryError("provider-error", "Provider model discovery failed")

	const contentLength = Number(response.headers.get("content-length") ?? 0)
	if (contentLength > MAX_RESPONSE_BYTES)
		throw new ModelDiscoveryError("provider-error", "Provider response is too large")

	let bytes = 0
	const chunks: Uint8Array[] = []
	if (response.body) {
		const reader = response.body.getReader()
		for (;;) {
			const { done, value } = await reader.read() // oxlint-disable-line no-await-in-loop -- sequential stream read requires await
			if (done) break
			bytes += value.byteLength
			if (bytes > MAX_RESPONSE_BYTES) {
				reader.cancel().catch(() => undefined)
				throw new ModelDiscoveryError("provider-error", "Provider response is too large")
			}
			chunks.push(value)
		}
	}
	const body = Buffer.concat(chunks).toString("utf8")
	try {
		return JSON.parse(body) as unknown
	} catch {
		throw new ModelDiscoveryError("provider-error", "Provider returned an invalid model list")
	}
}

export async function discoverModels(
	input: DiscoverModelsInput,
	fetcher: ModelDiscoveryFetch = fetch,
): Promise<string[]> {
	if (
		input.authMode === "deployment-identity" ||
		input.providerId === "azure" ||
		input.providerId === "amazon-bedrock"
	) {
		throw new ModelDiscoveryError("unsupported", "Model discovery is not supported for this provider configuration")
	}

	const apiKey = input.credentials?.apiKey
	if (!apiKey) throw new ModelDiscoveryError("unauthorized", "Provider credentials are required")

	if (input.providerId === "google") {
		const response = await fetchJson(
			`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
			{},
			fetcher,
		)
		return googleResponseSchema.parse(response).models.map(({ name }) => name.replace(/^models\//, ""))
	}

	const baseURL =
		input.providerId === "openai"
			? "https://api.openai.com/v1"
			: input.providerId === "anthropic"
				? "https://api.anthropic.com/v1"
				: input.providerId === "mistral"
					? (input.settings.baseURL ?? "https://api.mistral.ai/v1")
					: input.settings.baseURL
	if (!baseURL) throw new ModelDiscoveryError("provider-error", "Provider base URL is required")
	try {
		assertHttpBaseUrl(baseURL)
	} catch {
		throw new ModelDiscoveryError("provider-error", "Provider base URL must use HTTP or HTTPS")
	}

	const headers: Record<string, string> =
		input.providerId === "anthropic"
			? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
			: { Authorization: `Bearer ${apiKey}` }
	const response = await fetchJson(modelsUrl(baseURL), headers, fetcher)
	return openAiResponseSchema.parse(response).data.map(({ id }) => id)
}
