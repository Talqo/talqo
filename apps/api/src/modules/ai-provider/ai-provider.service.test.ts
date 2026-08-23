import { describe, expect, it } from "bun:test"

import type { SaveConfigurationInput } from "./ai-provider.contract.ts"
import type { StoredConfiguration } from "./ai-provider.service.ts"

import {
	createAiProviderService,
	InvalidConfigurationError,
	PermissionDeniedError,
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

function createMemoryService(authorized = true) {
	let stored: StoredConfiguration | undefined
	const service = createAiProviderService({
		authorize: async () => authorized,
		vault: createCredentialVault(APP_SECRET),
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
			text: { ...reordered.text, credentials: undefined },
			embedding: reordered.embedding,
		})

		expect(result.text?.hasCredentials).toBe(true)
	})

	it("requires credentials when switching from reused to separate embedding credentials", async () => {
		const { service } = createMemoryService()
		await service.saveConfiguration("user-1", input)

		await expect(
			service.saveConfiguration("user-1", {
				...input,
				expectedRevision: 1,
				text: { ...input.text, credentials: undefined },
				embedding: { ...input.embedding, credentialSource: "separate", credentials: undefined },
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
})
