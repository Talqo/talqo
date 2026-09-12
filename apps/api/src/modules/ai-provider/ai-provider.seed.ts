import { env } from "@/config/env.ts"

import * as repo from "./ai-provider.repository.ts"
import { createCredentialVault } from "./credential-vault.ts"

export const reset = repo.reset

export async function seed(providerBaseUrl: string): Promise<void> {
	const credentials = createCredentialVault(env.APP_SECRET).encrypt(
		{ apiKey: "e2e-provider-key" },
		{ configId: "singleton", providerId: "openai-compatible", role: "text" },
	)
	const text = {
		providerId: "openai-compatible" as const,
		modelId: "chat-model",
		authMode: "static" as const,
		settings: { baseURL: providerBaseUrl },
		credentials,
	}
	const saved = await repo.save(
		{
			id: "singleton",
			text,
			embedding: {
				...text,
				modelId: "embedding-model",
				credentialSource: "text",
				credentials: null,
			},
		},
		0,
	)
	if (!saved) throw new Error("Could not seed the E2E AI provider configuration")
}
