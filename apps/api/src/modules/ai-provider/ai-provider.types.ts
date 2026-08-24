import type { AiProviderId, AuthMode } from "./ai-provider.registry.ts"
import type { CredentialEnvelope } from "./credential-vault.ts"

export type StoredTextConfiguration = {
	authMode: AuthMode
	credentials: CredentialEnvelope | null
	modelId: string
	providerId: AiProviderId
	settings: Record<string, string>
}

export type StoredEmbeddingConfiguration = StoredTextConfiguration & {
	credentialSource: "text" | "separate" | "deployment-identity"
}

export type StoredConfiguration = {
	id: string
	revision: number
	text: StoredTextConfiguration
	embedding: StoredEmbeddingConfiguration
}
