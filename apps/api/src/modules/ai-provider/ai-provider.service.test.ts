import { createCredentialVault } from "@/lib/credential-vault.ts"
import { APICallError } from "@ai-sdk/provider"
import { describe, expect, it, mock } from "bun:test"

import type { SaveConfigurationInput } from "./ai-provider.contract.ts"
import type { StoredConfiguration } from "./ai-provider.service.ts"

import {
	createAiProviderService,
	InvalidConfigurationError,
	ProviderContextLimitError,
	UnusableConfigurationError,
} from "./ai-provider.service.ts"

const APP_SECRET = Buffer.alloc(32, 5).toString("base64url")

const actualAi = await import("ai")
const embedCalls: Parameters<typeof actualAi.embed>[0][] = []
await mock.module("ai", () => ({
	...actualAi,
	embed: async (options: Parameters<typeof actualAi.embed>[0]) => {
		embedCalls.push(options)
		return { embedding: [] } as never
	},
}))

const azureInput = (settings: Record<string, string>): SaveConfigurationInput => ({
	expectedRevision: 0,
	text: {
		providerId: "azure",
		modelId: "gpt-5",
		authMode: "static",
		settings,
		credentials: { apiKey: "sk-azure" },
	},
	embedding: {
		providerId: "azure",
		modelId: "text-embedding-3-small",
		authMode: "static",
		settings,
		credentialSource: "text",
	},
})

const input: SaveConfigurationInput = {
	expectedRevision: 0,
	text: {
		providerId: "openai",
		modelId: "gpt-5-mini",
		authMode: "static",
		settings: {},
		credentials: { apiKey: "sk-text" },
	},
	embedding: {
		providerId: "openai",
		modelId: "text-embedding-3-small",
		authMode: "static",
		settings: {},
		credentialSource: "text",
	},
}

function createMemoryService(
	generate?: Parameters<typeof createAiProviderService>[0]["generate"],
	streamText?: Parameters<typeof createAiProviderService>[0]["streamText"],
) {
	let stored: StoredConfiguration | undefined
	const service = createAiProviderService({
		vault: createCredentialVault(APP_SECRET, "talqo:ai-provider-credentials:v1"),
		generate,
		streamText,
		discover: async () => ["model-a"],
		repository: {
			find: async () => stored,
			save: async (configuration, expectedRevision) => {
				if ((stored?.revision ?? 0) !== expectedRevision) return undefined
				stored = { ...configuration, revision: expectedRevision + 1 }
				return stored
			},
		},
	})
	return { service, getStored: () => stored }
}

describe("AI provider service", () => {
	it("can generate text only once usable text credentials are stored", async () => {
		const { service, getStored } = createMemoryService()
		expect(await service.canGenerateText()).toBe(false)

		await service.saveConfiguration(input)
		expect(await service.canGenerateText()).toBe(true)

		const stored = getStored()
		if (!stored?.text.credentials) throw new Error("Expected encrypted text credentials")
		stored.text.credentials = { ...stored.text.credentials, ciphertext: "corrupted" }
		expect(await service.canGenerateText()).toBe(false)
	})

	it("reports whether a save changes the embedding index key", async () => {
		const { service } = createMemoryService()
		const changed: (boolean | undefined)[] = []
		const report = (fields: { "ai.embedding.changed"?: boolean }) => changed.push(fields["ai.embedding.changed"])

		await service.saveConfiguration(input, report)
		await service.saveConfiguration(
			{ ...input, expectedRevision: 1, text: { ...input.text, modelId: "gpt-5" } },
			report,
		)
		await service.saveConfiguration(
			{ ...input, expectedRevision: 2, embedding: { ...input.embedding, modelId: "text-embedding-3-large" } },
			report,
		)

		expect(changed).toEqual([true, false, true])
	})

	it("can generate text while separate embedding credentials are unusable", async () => {
		const { service, getStored } = createMemoryService()
		await service.saveConfiguration({
			...input,
			embedding: {
				providerId: "openai",
				modelId: "text-embedding-3-small",
				authMode: "static",
				settings: {},
				credentialSource: "separate",
				credentials: { apiKey: "sk-embedding" },
			},
		})
		const stored = getStored()
		if (!stored?.embedding.credentials) throw new Error("Expected encrypted embedding credentials")
		stored.embedding.credentials = { ...stored.embedding.credentials, ciphertext: "corrupted" }

		expect((await service.getConfiguration()).health).toBe("unusable")
		expect(await service.canGenerateText()).toBe(true)
	})

	it("reuses stored credentials when settings arrive in a different key order", async () => {
		const { service } = createMemoryService()
		await service.saveConfiguration(azureInput({ apiVersion: "2024-06-01", baseURL: "https://example.com" }))

		const reordered = azureInput({ baseURL: "https://example.com", apiVersion: "2024-06-01" })
		const result = await service.saveConfiguration({
			expectedRevision: 1,
			text: { ...reordered.text, authMode: "static", credentials: undefined },
			embedding: reordered.embedding,
		})

		expect(result.text?.hasCredentials).toBe(true)
	})

	it("requires credentials when switching from reused to separate embedding credentials", async () => {
		const { service } = createMemoryService()
		await service.saveConfiguration(input)

		await expect(
			service.saveConfiguration({
				...input,
				expectedRevision: 1,
				text: { ...input.text, authMode: "static", credentials: undefined },
				embedding: { ...input.embedding, authMode: "static", credentialSource: "separate", credentials: undefined },
			}),
		).rejects.toBeInstanceOf(InvalidConfigurationError)
	})

	it("discovers models without saving transient credentials", async () => {
		const { service, getStored } = createMemoryService()

		const models = await service.discoverModels({
			providerId: "openai",
			authMode: "static",
			settings: {},
			credentials: { apiKey: "transient" },
		})

		expect(models).toEqual(["model-a"])
		expect(getStored()).toBeUndefined()
	})

	it("prepares the embedding role without decrypting unrelated text credentials", async () => {
		const { service, getStored } = createMemoryService()
		await service.saveConfiguration({
			...input,
			embedding: {
				providerId: "openai",
				modelId: "text-embedding-3-small",
				authMode: "static",
				settings: {},
				credentialSource: "separate",
				credentials: { apiKey: "sk-embedding" },
			},
		})
		const stored = getStored()
		if (!stored?.text.credentials) throw new Error("Expected stored text credentials")
		stored.text.credentials = { ...stored.text.credentials, tag: "invalid-tag" }

		const prepared = await service.prepareEmbeddingOperation()

		expect(typeof prepared.embed).toBe("function")
	})

	it("passes the caller's abort signal, or the configured timeout, to the embedding call", async () => {
		const { service } = createMemoryService()
		await service.saveConfiguration(input)
		const callsBefore = embedCalls.length

		const timed = await service.prepareEmbeddingOperation({ timeoutMs: 60_000 })
		await timed.embed("hello")
		const untimed = await service.prepareEmbeddingOperation()
		await untimed.embed("hello")
		const callerSignal = AbortSignal.abort()
		await timed.embed("hello", callerSignal)

		const calls = embedCalls.slice(callsBefore)
		expect(calls[0]).toMatchObject({ maxRetries: 0 })
		expect(calls[0]?.abortSignal).toBeInstanceOf(AbortSignal)
		expect(calls[1]?.abortSignal).toBeUndefined()
		expect(calls[2]?.abortSignal).toBe(callerSignal)
	})

	it("streams only the configured text model with retries disabled and normalized usage", async () => {
		let call: Record<string, unknown> | undefined
		const { service } = createMemoryService(async function* (generationInput) {
			call = generationInput
			yield { type: "text", text: "Hello" } as const
			yield {
				type: "finish",
				outcome: "completed",
				usage: { inputTokens: 5, outputTokens: 2 },
			} as const
		})
		await service.saveConfiguration(input)
		const controller = new AbortController()

		const prepared = await service.prepareTextOperation({
			messages: [{ role: "user", content: "Hi" }],
			maxOutputTokens: 77,
			timeoutMs: 9000,
		})
		const events = [
			{ type: "start", provider: prepared.provider, model: prepared.model },
			...(await Array.fromAsync(prepared.invoke(controller.signal))),
		]

		expect(call).toMatchObject({ maxRetries: 0, maxOutputTokens: 77, timeoutMs: 9000, signal: controller.signal })
		expect(call?.model).toMatchObject({ modelId: "gpt-5-mini" })
		expect(events).toEqual([
			{ type: "start", provider: "openai", model: "gpt-5-mini" },
			{ type: "text", text: "Hello" },
			{
				type: "finish",
				outcome: "completed",
				usage: { inputTokens: 5, outputTokens: 2 },
				provider: "openai",
				model: "gpt-5-mini",
			},
		])
	})

	it("passes the system prompt as AI SDK instructions instead of a model message", async () => {
		let call: Record<string, unknown> | undefined
		const { service } = createMemoryService(async function* (generationInput) {
			call = generationInput
			yield { type: "finish", outcome: "completed", usage: {} } as const
		})
		await service.saveConfiguration(input)

		const prepared = await service.prepareTextOperation({
			messages: [
				{ role: "system", content: "Answer as the configured agent." },
				{ role: "user", content: "Hi" },
			],
			maxOutputTokens: 10,
			timeoutMs: 1000,
		})
		await Array.fromAsync(prepared.invoke(new AbortController().signal))

		expect(call).toMatchObject({
			instructions: "Answer as the configured agent.",
			messages: [{ role: "user", content: "Hi" }],
		})
	})

	it("normalizes provider context-window rejections without exposing their body", async () => {
		const { service } = createMemoryService(async function* () {
			yield* []
			throw new APICallError({
				message: "maximum context length exceeded: sensitive provider body",
				url: "https://provider.invalid",
				requestBodyValues: {},
				statusCode: 400,
				responseBody: '{"code":"context_length_exceeded"}',
			})
		})
		await service.saveConfiguration(input)

		const prepared = await service.prepareTextOperation({
			messages: [{ role: "user", content: "Hi" }],
			maxOutputTokens: 10,
			timeoutMs: 1000,
		})
		await expect(Array.fromAsync(prepared.invoke(new AbortController().signal))).rejects.toBeInstanceOf(
			ProviderContextLimitError,
		)
	})

	it.each([
		{
			name: "Anthropic",
			message: "prompt is too long: 213462 tokens > 200000 maximum",
			responseBody:
				'{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 213462 tokens > 200000 maximum"}}',
		},
		{
			name: "Google",
			message: "The input token count (1197653) exceeds the maximum number of tokens allowed (1048576).",
			responseBody:
				'{"error":{"code":400,"message":"The input token count (1197653) exceeds the maximum number of tokens allowed (1048576).","status":"INVALID_ARGUMENT"}}',
		},
	])("normalizes $name context-limit rejections", async ({ message, responseBody }) => {
		const { service } = createMemoryService(async function* () {
			yield* []
			throw new APICallError({
				message,
				url: "https://provider.invalid",
				requestBodyValues: {},
				statusCode: 400,
				responseBody,
			})
		})
		await service.saveConfiguration(input)

		const prepared = await service.prepareTextOperation({
			messages: [{ role: "user", content: "Hi" }],
			maxOutputTokens: 10,
			timeoutMs: 1000,
		})
		await expect(Array.fromAsync(prepared.invoke(new AbortController().signal))).rejects.toBeInstanceOf(
			ProviderContextLimitError,
		)
	})

	it("does not classify unrelated client errors as context-limit rejections", async () => {
		const { service } = createMemoryService(async function* () {
			yield* []
			throw new APICallError({
				message: "The model `gpt-0` does not exist",
				url: "https://provider.invalid",
				requestBodyValues: {},
				statusCode: 400,
				responseBody: '{"error":{"message":"The model `gpt-0` does not exist","code":"model_not_found"}}',
			})
		})
		await service.saveConfiguration(input)

		const prepared = await service.prepareTextOperation({
			messages: [{ role: "user", content: "Hi" }],
			maxOutputTokens: 10,
			timeoutMs: 1000,
		})
		await expect(Array.fromAsync(prepared.invoke(new AbortController().signal))).rejects.toBeInstanceOf(APICallError)
	})

	it("rejects corrupted stored credentials during preparation before provider invocation", async () => {
		let invoked = false
		const { service, getStored } = createMemoryService(async function* () {
			invoked = true
			yield* []
		})
		await service.saveConfiguration(input)
		const stored = getStored()
		if (!stored?.text.credentials) throw new Error("Expected encrypted text credentials")
		stored.text.credentials = { ...stored.text.credentials, ciphertext: "corrupted" }

		await expect(
			service.prepareTextOperation({
				messages: [{ role: "user", content: "Hi" }],
				maxOutputTokens: 77,
				timeoutMs: 9000,
			}),
		).rejects.toBeInstanceOf(UnusableConfigurationError)
		expect(invoked).toBe(false)
	})

	it("lets a tool result reach the model for five steps, then stops", async () => {
		const calls: Record<string, unknown>[] = []
		const { service } = createMemoryService(undefined, ((options: unknown) => {
			calls.push(options as Record<string, unknown>)
			return { textStream: (async function* () {})(), usage: Promise.resolve({}) }
		}) as never)
		await service.saveConfiguration(input)
		const prepared = await service.prepareTextOperation({
			messages: [{ role: "user", content: "Hi" }],
			maxOutputTokens: 77,
			timeoutMs: 9000,
		})

		await Array.fromAsync(prepared.invoke(new AbortController().signal))

		const stopWhen = calls[0]?.["stopWhen"] as (state: { steps: never[] }) => boolean
		expect(stopWhen({ steps: Array.from({ length: 4 }) })).toBe(false)
		expect(stopWhen({ steps: Array.from({ length: 5 }) })).toBe(true)
	})
})
