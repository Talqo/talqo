import { env } from "@/config/env.ts"

import { validateConfigurationInput } from "./ai-provider.configuration.ts"
import * as repo from "./ai-provider.repository.ts"
import { createCredentialVault } from "./credential-vault.ts"

export async function seed(): Promise<void> {
	const baseUrl = Bun.env.TALQO_SEED_AI_BASE_URL?.trim()
	const apiKey = Bun.env.TALQO_SEED_AI_API_KEY?.trim()
	const textModel = Bun.env.TALQO_SEED_TEXT_MODEL?.trim()
	const embeddingModel = Bun.env.TALQO_SEED_EMBEDDING_MODEL?.trim()
	if (!baseUrl && !apiKey && !textModel && !embeddingModel) return
	if (!baseUrl || !apiKey || !textModel || !embeddingModel) {
		throw new Error("Seed AI provider configuration is incomplete; set all TALQO_SEED_AI_* variables")
	}

	if (await repo.find()) return
	validateConfigurationInput({
		expectedRevision: 0,
		text: {
			providerId: "openai-compatible",
			modelId: textModel,
			authMode: "static",
			settings: { baseURL: baseUrl },
			credentials: { apiKey },
		},
		embedding: {
			providerId: "openai-compatible",
			modelId: embeddingModel,
			authMode: "static",
			settings: { baseURL: baseUrl },
			credentialSource: "text",
		},
	})
	const credentials = createCredentialVault(env.APP_SECRET).encrypt(
		{ apiKey },
		{ configId: "singleton", providerId: "openai-compatible", role: "text" },
	)
	const text = {
		providerId: "openai-compatible" as const,
		modelId: textModel,
		authMode: "static" as const,
		settings: { baseURL: baseUrl },
		credentials,
	}
	const saved = await repo.save(
		{
			id: "singleton",
			text,
			embedding: {
				...text,
				modelId: embeddingModel,
				credentialSource: "text",
				credentials: null,
			},
		},
		0,
	)
	if (!saved) throw new Error("Could not seed the AI provider configuration")
}
