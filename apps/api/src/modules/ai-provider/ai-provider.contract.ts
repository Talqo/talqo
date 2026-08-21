import { z } from "zod"

import { AI_PROVIDER_IDS, AI_PROVIDER_ROLES, AUTH_MODES } from "./ai-provider.registry.ts"

const stringRecordSchema = z.record(z.string(), z.string())

export const roleConfigurationRequestSchema = z.object({
	providerId: z.enum(AI_PROVIDER_IDS),
	modelId: z.string().trim().min(1),
	authMode: z.enum(AUTH_MODES),
	settings: stringRecordSchema,
	credentials: stringRecordSchema.optional(),
})

export const embeddingConfigurationRequestSchema = roleConfigurationRequestSchema.extend({
	credentialSource: z.enum(["text", "separate", "deployment-identity"]),
})

export const saveConfigurationRequestSchema = z.object({
	expectedRevision: z.number().int().nonnegative(),
	text: roleConfigurationRequestSchema,
	embedding: embeddingConfigurationRequestSchema,
})

export type SaveConfigurationInput = z.infer<typeof saveConfigurationRequestSchema>

export const discoverModelsRequestSchema = z.object({
	providerId: z.enum(AI_PROVIDER_IDS),
	authMode: z.enum(AUTH_MODES),
	settings: stringRecordSchema,
	credentials: stringRecordSchema.optional(),
	storedCredentialRole: z.enum(AI_PROVIDER_ROLES).optional(),
})

export type DiscoverModelsInput = z.infer<typeof discoverModelsRequestSchema>

export const providerMetadataResponseSchema = z.object({
	providers: z.array(
		z.object({
			id: z.enum(AI_PROVIDER_IDS),
			roles: z.array(z.enum(AI_PROVIDER_ROLES)),
			authModes: z.array(z.enum(AUTH_MODES)),
			settingFields: z.array(z.string()),
			requiredSettingFields: z.array(z.string()),
			credentialFields: z.array(z.string()),
			requiredCredentialFields: z.array(z.string()),
			discovery: z.boolean(),
		}),
	),
})

export const modelDiscoveryResponseSchema = z.object({ models: z.array(z.string()) })

const redactedRoleSchema = z.object({
	providerId: z.enum(AI_PROVIDER_IDS),
	modelId: z.string(),
	authMode: z.enum(AUTH_MODES),
	settings: stringRecordSchema,
	hasCredentials: z.boolean(),
})

export const configurationResponseSchema = z.object({
	revision: z.number().int().nonnegative(),
	health: z.enum(["unconfigured", "configured", "unusable"]),
	text: redactedRoleSchema.nullable(),
	embedding: redactedRoleSchema
		.extend({ credentialSource: z.enum(["text", "separate", "deployment-identity"]) })
		.nullable(),
})
