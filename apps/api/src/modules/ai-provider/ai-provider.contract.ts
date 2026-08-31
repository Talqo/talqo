import { problemResponse, sessionSecurity } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
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

const malformedJson = problemResponse([PROBLEM_CODES.MALFORMED_JSON])
const authRequired = problemResponse([PROBLEM_CODES.AUTHENTICATION_REQUIRED])
const forbidden = problemResponse([PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED, PROBLEM_CODES.PERMISSION_DENIED])
const serverError = problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR])
const providerError = problemResponse([
	PROBLEM_CODES.MODEL_DISCOVERY_UNSUPPORTED,
	PROBLEM_CODES.PROVIDER_ERROR,
	PROBLEM_CODES.PROVIDER_UNREACHABLE,
])

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
		400: malformedJson,
		401: authRequired,
		403: forbidden,
		500: serverError,
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
		400: malformedJson,
		401: authRequired,
		403: forbidden,
		500: serverError,
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
		400: problemResponse([
			PROBLEM_CODES.INVALID_AI_PROVIDER_CONFIGURATION,
			PROBLEM_CODES.INVALID_REQUEST,
			PROBLEM_CODES.MALFORMED_JSON,
		]),
		401: authRequired,
		403: forbidden,
		409: problemResponse([PROBLEM_CODES.CONFIGURATION_CONFLICT]),
		500: serverError,
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
		400: problemResponse([
			PROBLEM_CODES.INVALID_AI_PROVIDER_CONFIGURATION,
			PROBLEM_CODES.INVALID_REQUEST,
			PROBLEM_CODES.MALFORMED_JSON,
			PROBLEM_CODES.PROVIDER_CREDENTIALS_REJECTED,
		]),
		401: authRequired,
		403: forbidden,
		429: problemResponse([PROBLEM_CODES.PROVIDER_RATE_LIMITED]),
		500: serverError,
		502: providerError,
	},
})
