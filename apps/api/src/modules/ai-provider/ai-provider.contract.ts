import {
	badRequestResponse,
	conflictResponse,
	forbiddenResponse,
	internalServerErrorResponse,
	sessionSecurity,
	unauthorizedResponse,
} from "@/http/openapi.ts"
import { createRoute, z } from "@hono/zod-openapi"

import { AI_PROVIDER_IDS, AI_PROVIDER_ROLES, AUTH_MODES } from "./ai-provider.registry.ts"

const stringRecordSchema = z.record(z.string(), z.string())
const credentialSourceSchema = z.enum(["text", "separate", "deployment-identity"])

const staticRoleShape = {
	providerId: z.enum(AI_PROVIDER_IDS),
	modelId: z.string().trim().min(1),
	authMode: z.literal("static"),
	settings: stringRecordSchema,
	credentials: stringRecordSchema.optional(),
}

const deploymentIdentityRoleShape = {
	providerId: z.enum(AI_PROVIDER_IDS),
	modelId: z.string().trim().min(1),
	authMode: z.literal("deployment-identity"),
	settings: stringRecordSchema,
}

export const roleConfigurationRequestSchema = z.discriminatedUnion("authMode", [
	z.strictObject(staticRoleShape),
	z.strictObject(deploymentIdentityRoleShape),
])

export const embeddingConfigurationRequestSchema = z.discriminatedUnion("authMode", [
	z.strictObject({ ...staticRoleShape, credentialSource: credentialSourceSchema }),
	z.strictObject({ ...deploymentIdentityRoleShape, credentialSource: credentialSourceSchema }),
])

export const saveConfigurationRequestSchema = z.strictObject({
	expectedRevision: z.number().int().nonnegative(),
	text: roleConfigurationRequestSchema,
	embedding: embeddingConfigurationRequestSchema,
})

export type SaveConfigurationInput = z.infer<typeof saveConfigurationRequestSchema>

export const discoverModelsRequestSchema = z.discriminatedUnion("authMode", [
	z.strictObject({
		providerId: z.enum(AI_PROVIDER_IDS),
		authMode: z.literal("static"),
		settings: stringRecordSchema,
		credentials: stringRecordSchema.optional(),
		storedCredentialRole: z.enum(AI_PROVIDER_ROLES).optional(),
	}),
	z.strictObject({
		providerId: z.enum(AI_PROVIDER_IDS),
		authMode: z.literal("deployment-identity"),
		settings: stringRecordSchema,
	}),
])

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

export const modelDiscoveryErrorResponseSchema = z.object({
	error: z.string(),
	code: z.enum(["unauthorized", "unreachable", "rate-limited", "unsupported", "provider-error"]).optional(),
})

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
	embedding: redactedRoleSchema.extend({ credentialSource: credentialSourceSchema }).nullable(),
})

export const listAiProvidersRoute = createRoute({
	method: "get",
	path: "/ai-providers",
	operationId: "listAiProviders",
	tags: ["AI Providers"],
	security: sessionSecurity,
	responses: {
		200: {
			content: { "application/json": { schema: providerMetadataResponseSchema } },
			description: "Supported AI providers",
		},
		401: unauthorizedResponse,
		403: forbiddenResponse,
		500: internalServerErrorResponse,
	},
})

export const getAiProviderConfigurationRoute = createRoute({
	method: "get",
	path: "/ai-provider-configuration",
	operationId: "getAiProviderConfiguration",
	tags: ["AI Providers"],
	security: sessionSecurity,
	responses: {
		200: {
			content: { "application/json": { schema: configurationResponseSchema } },
			description: "Redacted AI provider configuration",
		},
		401: unauthorizedResponse,
		403: forbiddenResponse,
		500: internalServerErrorResponse,
	},
})

export const saveAiProviderConfigurationRoute = createRoute({
	method: "put",
	path: "/ai-provider-configuration",
	operationId: "saveAiProviderConfiguration",
	tags: ["AI Providers"],
	security: sessionSecurity,
	request: {
		body: { content: { "application/json": { schema: saveConfigurationRequestSchema } }, required: true },
	},
	responses: {
		200: {
			content: { "application/json": { schema: configurationResponseSchema } },
			description: "Saved AI provider configuration",
		},
		400: badRequestResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		409: conflictResponse,
		500: internalServerErrorResponse,
	},
})

export const discoverAiProviderModelsRoute = createRoute({
	method: "post",
	path: "/ai-provider-models/discover",
	operationId: "discoverAiProviderModels",
	tags: ["AI Providers"],
	security: sessionSecurity,
	request: {
		body: { content: { "application/json": { schema: discoverModelsRequestSchema } }, required: true },
	},
	responses: {
		200: {
			content: { "application/json": { schema: modelDiscoveryResponseSchema } },
			description: "Discovered model identifiers",
		},
		400: {
			content: { "application/json": { schema: modelDiscoveryErrorResponseSchema } },
			description: "Invalid request or rejected provider credentials",
		},
		401: unauthorizedResponse,
		403: forbiddenResponse,
		429: {
			content: { "application/json": { schema: modelDiscoveryErrorResponseSchema } },
			description: "Provider rate limit reached",
		},
		500: internalServerErrorResponse,
		502: {
			content: { "application/json": { schema: modelDiscoveryErrorResponseSchema } },
			description: "Provider discovery failed",
		},
	},
})
