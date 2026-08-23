import type { GetAiProviderConfiguration200 } from "@/api/generated/models/ai-providers/getAiProviderConfiguration200.zod.ts"
import type { ListAiProviders200 } from "@/api/generated/models/ai-providers/listAiProviders200.zod.ts"
import type { SaveAiProviderConfigurationBody } from "@/api/generated/models/ai-providers/saveAiProviderConfigurationBody.zod.ts"

export type AiProviderConfiguration = GetAiProviderConfiguration200
export type ProviderMetadata = ListAiProviders200["providers"][number]
export type AiProviderId = ProviderMetadata["id"]
export type AiProviderAuthMode = ProviderMetadata["authModes"][number]
export type AiProviderRole = "text" | "embedding"
export type RedactedRoleConfiguration = NonNullable<AiProviderConfiguration["text"]>
export type SaveAiProviderConfigurationInput = SaveAiProviderConfigurationBody
export type RoleConfigurationInput = {
	authMode: AiProviderAuthMode
	modelId: string
	providerId: AiProviderId
	settings: Record<string, string>
}
