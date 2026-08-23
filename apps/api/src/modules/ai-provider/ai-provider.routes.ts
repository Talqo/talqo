import type { AuthedVariables } from "@/http/require-auth.ts"

import { parseJsonBody } from "@/http/json-body.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { Context, Hono } from "hono"
import { z } from "zod"

import {
	configurationResponseSchema,
	discoverModelsRequestSchema,
	modelDiscoveryResponseSchema,
	providerMetadataResponseSchema,
	saveConfigurationRequestSchema,
} from "./ai-provider.contract.ts"
import { ModelDiscoveryError } from "./ai-provider.discovery.ts"
import * as service from "./ai-provider.service.ts"

function errorResponse(c: Context<{ Variables: AuthedVariables }>, error: unknown) {
	if (error instanceof service.PermissionDeniedError) {
		return c.json({ error: error.message }, HTTP_STATUS.FORBIDDEN)
	}
	if (error instanceof service.RevisionConflictError) {
		return c.json({ error: error.message }, HTTP_STATUS.CONFLICT)
	}
	if (error instanceof service.InvalidConfigurationError) {
		return c.json({ error: error.message }, HTTP_STATUS.BAD_REQUEST)
	}
	if (error instanceof ModelDiscoveryError) {
		const status =
			error.code === "unauthorized"
				? HTTP_STATUS.BAD_REQUEST
				: error.code === "rate-limited"
					? HTTP_STATUS.TOO_MANY_REQUESTS
					: HTTP_STATUS.BAD_GATEWAY
		return c.json({ error: error.message, code: error.code }, status)
	}
	throw error
}

export const aiProviderRoutes = new Hono<{ Variables: AuthedVariables }>()
	.get("/api/ai-providers", async (c) => {
		try {
			return c.json(providerMetadataResponseSchema.parse({ providers: await service.getProviders(c.get("user").id) }))
		} catch (error) {
			return errorResponse(c, error)
		}
	})
	.get("/api/ai-provider-configuration", async (c) => {
		try {
			return c.json(configurationResponseSchema.parse(await service.getConfiguration(c.get("user").id)))
		} catch (error) {
			return errorResponse(c, error)
		}
	})
	.post("/api/ai-provider-models/discover", async (c) => {
		const body = discoverModelsRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)
		try {
			return c.json(
				modelDiscoveryResponseSchema.parse({ models: await service.discoverModels(c.get("user").id, body.data) }),
			)
		} catch (error) {
			return errorResponse(c, error)
		}
	})
	.put("/api/ai-provider-configuration", async (c) => {
		const body = saveConfigurationRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)
		try {
			return c.json(configurationResponseSchema.parse(await service.saveConfiguration(c.get("user").id, body.data)))
		} catch (error) {
			return errorResponse(c, error)
		}
	})
