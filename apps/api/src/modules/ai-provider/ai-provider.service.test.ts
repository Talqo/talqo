import { APICallError } from "@ai-sdk/provider"
import { describe, expect, it } from "bun:test"

import type { SaveConfigurationInput } from "./ai-provider.contract.ts"
import type { StoredConfiguration } from "./ai-provider.service.ts"

import {
	createAiProviderService,
	InvalidConfigurationError,
	PermissionDeniedError,
	ProviderContextLimitError,
	RevisionConflictError,
} from "./ai-provider.service.ts"
import { createCredentialVault } from "./credential-vault.ts"

const APP_SECRET = Buffer.alloc(32, 5).toString("base64url")

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

function createMemoryService(authorized = true, generate?: Parameters<typeof createAiProviderService>[0]["generate"]) {
	let stored: StoredConfiguration | undefined
	const service = createAiProviderService({
		authorize: async () => authorized,
		vault: createCredentialVault(APP_SECRET),
		generate,
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
	it("encrypts credentials and returns redacted configuration", async () => {
		const { service, getStored } = createMemoryService()

		const result = await service.saveConfiguration("user-1", input)

		expect(result.revision).toBe(1)
		expect(result.text?.hasCredentials).toBe(true)
		expect(JSON.stringify(result)).not.toContain("sk-text")
		expect(JSON.stringify(getStored())).not.toContain("sk-text")
	})

	it("denies operators without the management permission", async () => {
		const { service } = createMemoryService(false)

		await expect(service.getConfiguration("user-1")).rejects.toBeInstanceOf(PermissionDeniedError)
	})

	it("rejects a stale revision", async () => {
		const { service } = createMemoryService()
		await service.saveConfiguration("user-1", input)

		await expect(service.saveConfiguration("user-1", input)).rejects.toBeInstanceOf(RevisionConflictError)
	})

	it("reuses stored credentials when settings arrive in a different key order", async () => {
		const { service } = createMemoryService()
		await service.saveConfiguration("user-1", azureInput({ apiVersion: "2024-06-01", baseURL: "https://example.com" }))

		const reordered = azureInput({ baseURL: "https://example.com", apiVersion: "2024-06-01" })
		const result = await service.saveConfiguration("user-1", {
			expectedRevision: 1,
			text: { ...reordered.text, authMode: "static", credentials: undefined },
			embedding: reordered.embedding,
		})

		expect(result.text?.hasCredentials).toBe(true)
	})

	it("throws when a deployment-identity role carries static credentials", async () => {
		const { service } = createMemoryService()
		const invalid = {
			...input,
			text: {
				providerId: "azure",
				modelId: "gpt-5",
				authMode: "deployment-identity",
				settings: { baseURL: "https://example.openai.azure.com" },
				credentials: { apiKey: "sk-dropped" },
			},
		} as SaveConfigurationInput

		await expect(service.saveConfiguration("user-1", invalid)).rejects.toBeInstanceOf(InvalidConfigurationError)
	})

	it("requires credentials when switching from reused to separate embedding credentials", async () => {
		const { service } = createMemoryService()
		await service.saveConfiguration("user-1", input)

		await expect(
			service.saveConfiguration("user-1", {
				...input,
				expectedRevision: 1,
				text: { ...input.text, authMode: "static", credentials: undefined },
				embedding: { ...input.embedding, authMode: "static", credentialSource: "separate", credentials: undefined },
			}),
		).rejects.toBeInstanceOf(InvalidConfigurationError)
	})

	it("discovers models without saving transient credentials", async () => {
		const { service, getStored } = createMemoryService()

		const models = await service.discoverModels("user-1", {
			providerId: "openai",
			authMode: "static",
			settings: {},
			credentials: { apiKey: "transient" },
		})

		expect(models).toEqual(["model-a"])
		expect(getStored()).toBeUndefined()
	})

	it("constructs operation-scoped models from stored configuration", async () => {
		const { service } = createMemoryService()
		await service.saveConfiguration("user-1", input)

		const models = await service.createRuntimeModels()

		expect(models.text.modelId).toBe("gpt-5-mini")
		expect(models.embedding.modelId).toBe("text-embedding-3-small")
	})

	it("streams only the configured text model with retries disabled and normalized usage", async () => {
		let call: Record<string, unknown> | undefined
		const { service } = createMemoryService(true, async function* (generationInput) {
			call = generationInput
			yield { type: "text", text: "Hello" } as const
			yield {
				type: "finish",
				outcome: "completed",
				usage: { inputTokens: 5, outputTokens: 2 },
			} as const
		})
		await service.saveConfiguration("user-1", input)
		const controller = new AbortController()

		const events = []
		for await (const event of service.streamText({
			messages: [{ role: "user", content: "Hi" }],
			maxOutputTokens: 77,
			timeoutMs: 9000,
			signal: controller.signal,
		})) {
			events.push(event)
		}

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
		const { service } = createMemoryService(true, async function* (generationInput) {
			call = generationInput
			yield { type: "finish", outcome: "completed", usage: {} } as const
		})
		await service.saveConfiguration("user-1", input)

		await Array.fromAsync(
			service.streamText({
				messages: [
					{ role: "system", content: "Answer as the configured agent." },
					{ role: "user", content: "Hi" },
				],
				maxOutputTokens: 10,
				timeoutMs: 1000,
				signal: new AbortController().signal,
			}),
		)

		expect(call).toMatchObject({
			instructions: "Answer as the configured agent.",
			messages: [{ role: "user", content: "Hi" }],
		})
	})

	it("does not instantiate the configured embedding model for text generation", async () => {
		const { service } = createMemoryService(true, async function* () {
			yield { type: "finish", outcome: "completed", usage: {} } as const
		})
		await service.saveConfiguration("user-1", input)

		await Array.fromAsync(
			service.streamText({
				messages: [{ role: "user", content: "Hi" }],
				maxOutputTokens: 10,
				timeoutMs: 1000,
				signal: new AbortController().signal,
			}),
		)
	})

	it("normalizes provider context-window rejections without exposing their body", async () => {
		const { service } = createMemoryService(true, async function* () {
			yield* []
			throw new APICallError({
				message: "maximum context length exceeded: sensitive provider body",
				url: "https://provider.invalid",
				requestBodyValues: {},
				statusCode: 400,
				responseBody: '{"code":"context_length_exceeded"}',
			})
		})
		await service.saveConfiguration("user-1", input)

		await expect(
			Array.fromAsync(
				service.streamText({
					messages: [{ role: "user", content: "Hi" }],
					maxOutputTokens: 10,
					timeoutMs: 1000,
					signal: new AbortController().signal,
				}),
			),
		).rejects.toBeInstanceOf(ProviderContextLimitError)
	})
})
