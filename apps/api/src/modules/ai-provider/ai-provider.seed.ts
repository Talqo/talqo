import { env } from "@/config/env.ts"
import { createCredentialVault } from "@/lib/credential-vault.ts"

import type { SaveConfigurationInput } from "./ai-provider.contract.ts"
import type { StoredConfiguration, StoredEmbeddingConfiguration, StoredTextConfiguration } from "./ai-provider.types.ts"

import { validateConfigurationInput } from "./ai-provider.configuration.ts"
import * as repo from "./ai-provider.repository.ts"

type SeedEnvironment = {
	apiKey: string
	baseUrl: string
	embeddingModel: string
	textModel: string
}

function readSeedEnvironment(): SeedEnvironment | undefined {
	const baseUrl = Bun.env.TALQO_SEED_AI_BASE_URL?.trim()
	const apiKey = Bun.env.TALQO_SEED_AI_API_KEY?.trim()
	const textModel = Bun.env.TALQO_SEED_TEXT_MODEL?.trim()
	const embeddingModel = Bun.env.TALQO_SEED_EMBEDDING_MODEL?.trim()
	const configured = [baseUrl, apiKey, textModel, embeddingModel]
	if (configured.every((value) => !value)) return undefined
	if (!baseUrl || !apiKey || !textModel || !embeddingModel) {
		throw new Error("Seed AI provider configuration is incomplete; set all TALQO_SEED_AI_* variables")
	}
	return { baseUrl, apiKey, textModel, embeddingModel }
}

function seedInput(environment: SeedEnvironment, expectedRevision: number): SaveConfigurationInput {
	return {
		expectedRevision,
		text: {
			providerId: "openai-compatible",
			modelId: environment.textModel,
			authMode: "static",
			settings: { baseURL: environment.baseUrl },
			credentials: { apiKey: environment.apiKey },
		},
		embedding: {
			providerId: "openai-compatible",
			modelId: environment.embeddingModel,
			authMode: "static",
			settings: { baseURL: environment.baseUrl },
			credentialSource: "text",
		},
	}
}

function seedConfiguration(environment: SeedEnvironment): Omit<StoredConfiguration, "revision"> {
	const credentials = createCredentialVault(env.APP_SECRET, "talqo:ai-provider-credentials:v1").encrypt(
		{ apiKey: environment.apiKey },
		{ configId: "singleton", providerId: "openai-compatible", role: "text" },
	)
	const text: StoredTextConfiguration = {
		providerId: "openai-compatible",
		modelId: environment.textModel,
		authMode: "static",
		settings: { baseURL: environment.baseUrl },
		credentials,
	}
	const embedding: StoredEmbeddingConfiguration = {
		...text,
		modelId: environment.embeddingModel,
		credentialSource: "text",
		credentials: null,
	}
	return { id: "singleton", text, embedding }
}

export async function seed(): Promise<void> {
	const seedEnvironment = readSeedEnvironment()
	if (!seedEnvironment) return

	const existing = await repo.find()
	const expectedRevision = existing?.revision ?? 0
	validateConfigurationInput(seedInput(seedEnvironment, expectedRevision))
	const saved = await repo.save(seedConfiguration(seedEnvironment), expectedRevision)
	if (!saved) throw new Error("Could not seed the AI provider configuration")
}
