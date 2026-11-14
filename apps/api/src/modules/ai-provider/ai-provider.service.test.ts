import { PROBLEM_CODES } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { createCredentialVault } from "@/lib/credential-vault.ts"
import { APICallError } from "@ai-sdk/provider"
import { describe, expect, it, mock } from "bun:test"

import type { SaveConfigurationInput } from "./ai-provider.contract.ts"
import type { DiscoveryRequest } from "./ai-provider.discovery.ts"
import type { StoredConfiguration, ToolEvent } from "./ai-provider.service.ts"

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

const separateEmbedding: NonNullable<SaveConfigurationInput["embedding"]> = {
	providerId: "openai",
	modelId: "text-embedding-3-small",
	authMode: "static",
	settings: {},
	credentialSource: "separate",
	credentials: { apiKey: "sk-embedding" },
}

function createMemoryService(
	generate?: Parameters<typeof createAiProviderService>[0]["generate"],
	streamText?: Parameters<typeof createAiProviderService>[0]["streamText"],
) {
	let stored: StoredConfiguration | undefined
	const discoverRequests: DiscoveryRequest[] = []
	const service = createAiProviderService({
		vault: createCredentialVault(APP_SECRET, "talqo:ai-provider-credentials:v1"),
		generate,
		streamText,
		discover: async (request) => {
			discoverRequests.push(request)
			return ["model-a"]
		},
		repository: {
			find: async () => stored,
			save: async (configuration, expectedRevision) => {
				if ((stored?.revision ?? 0) !== expectedRevision) return undefined
				stored = { ...configuration, revision: expectedRevision + 1 }
				return stored
			},
		},
	})
	return { service, getStored: () => stored, discoverRequests }
}

async function prepareText(service: ReturnType<typeof createMemoryService>["service"]) {
	await service.saveConfiguration(input)
	return service.prepareTextOperation({
		messages: [{ role: "user", content: "Hi" }],
		maxOutputTokens: 10,
		timeoutMs: 1000,
	})
}

async function prepareStreamingText(maxOutputTokens: number, timeoutMs: number) {
	const streamCalls: StreamTextOptions[] = []
	const { service } = createMemoryService(
		undefined,
		fakeStreamText({ textStream: (async function* () {})(), usage: Promise.resolve({}) }, streamCalls),
	)
	await service.saveConfiguration(input)
	const prepared = await service.prepareTextOperation({
		messages: [{ role: "user", content: "Hi" }],
		maxOutputTokens,
		timeoutMs,
	})
	return { prepared, streamCalls }
}

function failingGenerate(error: unknown): Parameters<typeof createAiProviderService>[0]["generate"] {
	return async function* () {
		yield* []
		throw error
	}
}

type ToolCall = { toolCallId: string; toolName: string }
type ToolOutput = { type: string } & Record<string, unknown>
type StreamTextOptions = Record<string, unknown> & {
	onToolExecutionEnd?: (event: { toolCall: ToolCall; toolOutput: ToolOutput }) => void
	onToolExecutionStart?: (event: { toolCall: ToolCall }) => void
}

function fakeStreamText(
	result: { textStream: AsyncIterable<string>; usage: Promise<Record<string, unknown>> },
	calls: StreamTextOptions[] = [],
) {
	return ((options: StreamTextOptions) => {
		calls.push(options)
		return result
	}) as never
}

function callStart(options: StreamTextOptions | undefined, toolName: string, toolCallId: string) {
	options?.onToolExecutionStart?.({ toolCall: { toolName, toolCallId } })
}

function callEnd(options: StreamTextOptions | undefined, toolName: string, toolCallId: string, toolOutput: ToolOutput) {
	options?.onToolExecutionEnd?.({ toolCall: { toolName, toolCallId }, toolOutput })
}

const changedSettingsCases: { name: string; settings: Record<string, string> }[] = [
	{ name: "a different setting value", settings: { baseURL: "https://example.com", apiVersion: "2024-11-01" } },
	{ name: "a different set of setting keys", settings: { baseURL: "https://example.com" } },
]

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
			embedding: separateEmbedding,
		})
		const stored = getStored()
		if (!stored?.embedding.credentials) throw new Error("Expected encrypted embedding credentials")
		stored.embedding.credentials = { ...stored.embedding.credentials, ciphertext: "corrupted" }

		expect((await service.getConfiguration()).health).toBe("unusable")
		expect(await service.canGenerateText()).toBe(true)
	})

	it("reuses stored credentials when settings arrive in a different key order", async () => {
		const { service } = createMemoryService()
		const changed: (boolean | undefined)[] = []
		const report = (fields: { "ai.embedding.changed"?: boolean }) => changed.push(fields["ai.embedding.changed"])
		await service.saveConfiguration(azureInput({ apiVersion: "2024-06-01", baseURL: "https://example.com" }), report)

		const reordered = azureInput({ baseURL: "https://example.com", apiVersion: "2024-06-01" })
		const result = await service.saveConfiguration(
			{
				expectedRevision: 1,
				text: { ...reordered.text, authMode: "static", credentials: undefined },
				embedding: reordered.embedding,
			},
			report,
		)

		expect(result.text?.hasCredentials).toBe(true)
		// Settings key order must not change the embedding index key.
		expect(changed).toEqual([true, false])
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
			embedding: separateEmbedding,
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
		const prepared = await prepareText(service)
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
		const prepared = await prepareText(service)
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
		const prepared = await prepareText(service)
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

	it.each([
		{
			name: "a payload-too-large status",
			statusCode: 413,
			message: "input too large",
			contextLimit: true,
		},
		{
			name: "a context-window message",
			statusCode: 400,
			message: "the context window is full",
			contextLimit: true,
		},
		{
			name: "a token-budget message",
			statusCode: 400,
			message: "too many tokens in the request",
			contextLimit: true,
		},
		{
			name: "a structured response code",
			statusCode: 400,
			message: "Bad Request",
			data: { error: { code: "context_length_exceeded" } },
			contextLimit: true,
		},
		{
			name: "the same text on a server error",
			statusCode: 500,
			message: "maximum context length exceeded",
			contextLimit: false,
		},
	])(
		"classifies $name as a context limit only for client rejections",
		async ({ statusCode, message, data, contextLimit }) => {
			const providerError = new APICallError({
				message,
				url: "https://provider.invalid",
				requestBodyValues: {},
				statusCode,
				data,
			})
			const { service } = createMemoryService(failingGenerate(providerError))
			const prepared = await prepareText(service)
			const invocation = Array.fromAsync(prepared.invoke(new AbortController().signal))

			if (contextLimit) await expect(invocation).rejects.toBeInstanceOf(ProviderContextLimitError)
			else await expect(invocation).rejects.toBe(providerError)
		},
	)

	it("passes non-provider failures through untouched", async () => {
		const failure = new Error("maximum context length exceeded")
		const { service } = createMemoryService(failingGenerate(failure))
		const prepared = await prepareText(service)

		await expect(Array.fromAsync(prepared.invoke(new AbortController().signal))).rejects.toBe(failure)
	})

	it("normalizes the AI SDK stream into text events and one completed finish event", async () => {
		const streamCalls: StreamTextOptions[] = []
		const { service } = createMemoryService(
			undefined,
			fakeStreamText(
				{
					textStream: (async function* () {
						yield "Hel"
						yield "lo"
					})(),
					usage: Promise.resolve({
						inputTokens: 5,
						inputTokenDetails: { cacheReadTokens: 3 },
						outputTokens: 2,
						outputTokenDetails: { reasoningTokens: 1 },
						totalTokens: 7,
					}),
				},
				streamCalls,
			),
		)
		await service.saveConfiguration(input)
		const prepared = await service.prepareTextOperation({
			messages: [{ role: "user", content: "Hi" }],
			maxOutputTokens: 10,
			timeoutMs: 1000,
		})

		const events = await Array.fromAsync(prepared.invoke(new AbortController().signal))

		expect(events).toEqual([
			{ type: "text", text: "Hel" },
			{ type: "text", text: "lo" },
			{
				type: "finish",
				outcome: "completed",
				usage: {
					inputTokens: 5,
					inputTokenDetails: { cacheReadTokens: 3 },
					outputTokens: 2,
					outputTokenDetails: { reasoningTokens: 1 },
					totalTokens: 7,
				},
				provider: "openai",
				model: "gpt-5-mini",
			},
		])
	})

	it("bounds the AI SDK stream with the caller's signal, timeout, and no retries", async () => {
		const { prepared, streamCalls } = await prepareStreamingText(77, 9000)
		const controller = new AbortController()

		await Array.fromAsync(prepared.invoke(controller.signal))

		expect(streamCalls[0]).toMatchObject({
			maxRetries: 0,
			maxOutputTokens: 77,
			timeout: 9000,
			abortSignal: controller.signal,
			model: { modelId: "gpt-5-mini" },
			messages: [{ role: "user", content: "Hi" }],
		})
		expect(typeof streamCalls[0]?.onError).toBe("function")
		expect("tools" in (streamCalls[0] ?? {})).toBe(false)
		expect(streamCalls[0]?.instructions).toBeUndefined()
	})

	it("reports an aborted generation as cancelled instead of failing", async () => {
		const { service } = createMemoryService(
			undefined,
			fakeStreamText({
				// oxlint-disable-next-line require-yield -- the stream throws before yielding
				textStream: (async function* () {
					throw new Error("provider aborted the stream")
				})(),
				usage: Promise.resolve({}),
			}),
		)
		await service.saveConfiguration(input)
		const prepared = await service.prepareTextOperation({
			messages: [{ role: "user", content: "Hi" }],
			maxOutputTokens: 10,
			timeoutMs: 1000,
		})
		const controller = new AbortController()
		controller.abort()

		const events = await Array.fromAsync(prepared.invoke(controller.signal))

		expect(events).toEqual([
			{ type: "finish", outcome: "cancelled", usage: {}, provider: "openai", model: "gpt-5-mini" },
		])
	})

	it("emits tool activity with the server identity and the failure envelope", async () => {
		const { prepared, streamCalls } = await prepareStreamingText(10, 1000)
		const toolEvents: ToolEvent[] = []
		const tools = { lookup: { description: "Looks a product up" } }
		const names = new Map([["lookup", { serverName: "Shopify", toolName: "lookup" }]])

		await Array.fromAsync(
			prepared.invoke(new AbortController().signal, { names, tools }, (event) => toolEvents.push(event)),
		)

		const options = streamCalls[0]
		expect(options?.tools).toBe(tools)
		callStart(options, "lookup", "call-1")
		callEnd(options, "lookup", "call-1", { type: "tool-result", output: { isError: true } })
		callEnd(options, "lookup", "call-2", { type: "tool-result", output: { content: [] } })
		callEnd(options, "unmapped", "call-3", { type: "tool-error", error: new Error("boom") })

		expect(toolEvents).toEqual([
			{ type: "tool-start", identity: { serverName: "Shopify", toolName: "lookup" }, toolCallId: "call-1" },
			{
				type: "tool-end",
				identity: { serverName: "Shopify", toolName: "lookup" },
				toolCallId: "call-1",
				outcome: "failed",
			},
			{
				type: "tool-end",
				identity: { serverName: "Shopify", toolName: "lookup" },
				toolCallId: "call-2",
				outcome: "completed",
			},
			{ type: "tool-end", identity: { serverName: "", toolName: "unmapped" }, toolCallId: "call-3", outcome: "failed" },
		])
	})

	it("treats an empty message list as a request without instructions", async () => {
		let call: Record<string, unknown> | undefined
		const { service } = createMemoryService(async function* (generationInput) {
			call = generationInput
			yield* []
		})
		await service.saveConfiguration(input)
		const prepared = await service.prepareTextOperation({ messages: [], maxOutputTokens: 1, timeoutMs: 1 })

		await Array.fromAsync(prepared.invoke(new AbortController().signal))

		expect(call).toMatchObject({ messages: [], instructions: undefined })
	})

	it("reports an unconfigured provider before any role can be prepared", async () => {
		const { service } = createMemoryService()

		expect(await service.getConfiguration()).toEqual({
			revision: 0,
			health: "unconfigured",
			text: null,
			embedding: null,
		})
		await expect(service.prepareTextOperation({ messages: [], maxOutputTokens: 1, timeoutMs: 1 })).rejects.toThrow(
			"AI provider configuration is missing",
		)
		await expect(service.prepareEmbeddingOperation()).rejects.toThrow("AI provider configuration is missing")
	})

	it("describes a deployment-identity configuration as usable without stored credentials", async () => {
		const { service } = createMemoryService()
		const settings = { baseURL: "https://example.openai.azure.com" }
		await service.saveConfiguration({
			expectedRevision: 0,
			text: { providerId: "azure", modelId: "gpt-5", authMode: "deployment-identity", settings },
			embedding: {
				providerId: "azure",
				modelId: "text-embedding-3-small",
				authMode: "deployment-identity",
				settings,
				credentialSource: "deployment-identity",
			},
		})

		const configuration = await service.getConfiguration()

		expect(configuration.health).toBe("configured")
		expect(configuration.text).toMatchObject({ hasCredentials: false })
		expect(configuration.embedding).toMatchObject({ hasCredentials: false, credentialSource: "deployment-identity" })
		expect(await service.canGenerateText()).toBe(true)
	})

	it("refuses to embed when the reused text credentials are corrupted", async () => {
		const { service, getStored } = createMemoryService()
		await service.saveConfiguration(input)
		const stored = getStored()
		if (!stored?.text.credentials) throw new Error("Expected stored text credentials")
		stored.text.credentials = { ...stored.text.credentials, ciphertext: "corrupted" }

		await expect(service.prepareEmbeddingOperation()).rejects.toBeInstanceOf(UnusableConfigurationError)
	})

	it("rejects incomplete static credentials on a resave", async () => {
		const { service } = createMemoryService()
		await service.saveConfiguration(input)

		await expect(
			service.saveConfiguration({
				...input,
				expectedRevision: 1,
				text: { ...input.text, authMode: "static", credentials: { apiKey: "   " } },
			}),
		).rejects.toThrow("openai credentials are incomplete")
	})

	it.each(changedSettingsCases)("refuses to reuse stored credentials after $name", async ({ settings }) => {
		const { service } = createMemoryService()
		await service.saveConfiguration(azureInput({ baseURL: "https://example.com", apiVersion: "2024-06-01" }))
		const changed = { ...azureInput(settings), expectedRevision: 1 }

		await expect(
			service.saveConfiguration({ ...changed, text: { ...changed.text, authMode: "static", credentials: undefined } }),
		).rejects.toThrow("credentials are required for the selected credential source")
	})

	it("rejects a configuration the provider does not allow", async () => {
		const { service } = createMemoryService()

		await expect(
			service.saveConfiguration({ ...input, text: { ...input.text, settings: { baseURL: "https://example.test" } } }),
		).rejects.toThrow("openai does not support setting: baseURL")
	})

	it("reports a revision conflict when the stored configuration moved on", async () => {
		const { service } = createMemoryService()

		const error = await service.saveConfiguration({ ...input, expectedRevision: 1 }).catch((cause: unknown) => cause)

		expect(error).toMatchObject({ problemCode: PROBLEM_CODES.CONFIGURATION_CONFLICT, status: HTTP_STATUS.CONFLICT })
		expect((error as Error).message).toBe("AI provider configuration changed; reload and retry")
	})

	it("exposes provider capabilities from the registry", () => {
		const { service } = createMemoryService()

		expect(service.getProviders()).toContainEqual({
			id: "azure",
			roles: ["text", "embedding"],
			authModes: ["static", "deployment-identity"],
			settingFields: ["baseURL", "apiVersion"],
			requiredSettingFields: ["baseURL"],
			credentialFields: ["apiKey"],
			requiredCredentialFields: ["apiKey"],
			discovery: false,
		})
	})

	it("discovers with stored credentials instead of transient ones", async () => {
		const { service, discoverRequests } = createMemoryService()
		await service.saveConfiguration(input)

		await service.discoverModels({
			providerId: "openai",
			authMode: "static",
			settings: {},
			storedCredentialRole: "text",
		})

		expect(discoverRequests[0]?.credentials).toEqual({ apiKey: "sk-text" })
	})

	it("falls back to text credentials for an embedding role that reuses them", async () => {
		const { service, discoverRequests } = createMemoryService()
		await service.saveConfiguration(input)

		await service.discoverModels({
			providerId: "openai",
			authMode: "static",
			settings: {},
			storedCredentialRole: "embedding",
		})

		expect(discoverRequests[0]?.credentials).toEqual({ apiKey: "sk-text" })
	})

	it("refuses stored credentials for a different provider context", async () => {
		const { service } = createMemoryService()
		await service.saveConfiguration(input)

		await expect(
			service.discoverModels({
				providerId: "openai",
				authMode: "static",
				settings: { project: "other-project" },
				storedCredentialRole: "text",
			}),
		).rejects.toThrow("Stored credentials do not match this provider context")
	})

	it("requires a stored configuration before reusing credentials", async () => {
		const { service } = createMemoryService()

		await expect(
			service.discoverModels({ providerId: "openai", authMode: "static", settings: {}, storedCredentialRole: "text" }),
		).rejects.toThrow("No stored credentials are available")
	})

	it("passes deployment identity through to discovery without credentials", async () => {
		const { service, discoverRequests } = createMemoryService()
		const settings = { baseURL: "https://example.openai.azure.com" }

		await service.discoverModels({ providerId: "azure", authMode: "deployment-identity", settings })

		expect(discoverRequests[0]).toEqual({
			authMode: "deployment-identity",
			providerId: "azure",
			settings,
			credentials: undefined,
		})
	})
})
