import type { AuthedVariables } from "@/http/require-auth.ts"

import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import {
	configurationResponseSchema,
	discoverAiProviderModelsRoute,
	getAiProviderConfigurationRoute,
	listAiProvidersRoute,
	modelDiscoveryResponseSchema,
	providerMetadataResponseSchema,
	saveAiProviderConfigurationRoute,
} from "./ai-provider.contract.ts"
import { ModelDiscoveryError } from "./ai-provider.discovery.ts"
import * as service from "./ai-provider.service.ts"

export const aiProviderRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(listAiProvidersRoute, async (c) => {
		try {
			const providers = await service.getProviders(c.get("user").id)
			return c.json(providerMetadataResponseSchema.parse({ providers }), HTTP_STATUS.OK)
		} catch (error) {
			if (error instanceof service.PermissionDeniedError) {
				return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
			}
			throw error
		}
	})
	.openapi(getAiProviderConfigurationRoute, async (c) => {
		try {
			const configuration = await service.getConfiguration(c.get("user").id)
			return c.json(configurationResponseSchema.parse(configuration), HTTP_STATUS.OK)
		} catch (error) {
			if (error instanceof service.PermissionDeniedError) {
				return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
			}
			throw error
		}
	})
	.openapi(saveAiProviderConfigurationRoute, async (c) => {
		try {
			const configuration = await service.saveConfiguration(c.get("user").id, c.req.valid("json"))
			return c.json(configurationResponseSchema.parse(configuration), HTTP_STATUS.OK)
		} catch (error) {
			if (error instanceof service.PermissionDeniedError) {
				return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
			}
			if (error instanceof service.RevisionConflictError) {
				return problemResponse(c, PROBLEM_CODES.CONFIGURATION_CONFLICT, HTTP_STATUS.CONFLICT)
			}
			if (error instanceof service.InvalidConfigurationError) {
				return problemResponse(c, PROBLEM_CODES.INVALID_AI_PROVIDER_CONFIGURATION, HTTP_STATUS.BAD_REQUEST)
			}
			throw error
		}
	})
	.openapi(discoverAiProviderModelsRoute, async (c) => {
		try {
			const models = await service.discoverModels(c.get("user").id, c.req.valid("json"))
			return c.json(modelDiscoveryResponseSchema.parse({ models }), HTTP_STATUS.OK)
		} catch (error) {
			if (error instanceof service.PermissionDeniedError) {
				return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
			}
			if (error instanceof service.InvalidConfigurationError) {
				return problemResponse(c, PROBLEM_CODES.INVALID_AI_PROVIDER_CONFIGURATION, HTTP_STATUS.BAD_REQUEST)
			}
			if (error instanceof ModelDiscoveryError) {
				if (error.code === "unauthorized") {
					return problemResponse(c, PROBLEM_CODES.PROVIDER_CREDENTIALS_REJECTED, HTTP_STATUS.BAD_REQUEST)
				}
				if (error.code === "rate-limited") {
					return problemResponse(c, PROBLEM_CODES.PROVIDER_RATE_LIMITED, HTTP_STATUS.TOO_MANY_REQUESTS)
				}
				if (error.code === "unreachable") {
					return problemResponse(c, PROBLEM_CODES.PROVIDER_UNREACHABLE, HTTP_STATUS.BAD_GATEWAY)
				}
				if (error.code === "unsupported") {
					return problemResponse(c, PROBLEM_CODES.MODEL_DISCOVERY_UNSUPPORTED, HTTP_STATUS.BAD_GATEWAY)
				}
				return problemResponse(c, PROBLEM_CODES.PROVIDER_ERROR, HTTP_STATUS.BAD_GATEWAY)
			}
			throw error
		}
	})
