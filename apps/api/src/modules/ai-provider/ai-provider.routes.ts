import { HTTP_STATUS } from "@/http/status.ts"
import { annotate, annotator } from "@/http/wide-event.ts"
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
import * as service from "./ai-provider.service.ts"

export const aiProviderRoutes = new OpenAPIHono()
	.openapi(listAiProvidersRoute, async (c) => {
		const providers = await service.getProviders()
		return c.json(providerMetadataResponseSchema.parse({ providers }), HTTP_STATUS.OK)
	})
	.openapi(getAiProviderConfigurationRoute, async (c) => {
		const configuration = await service.getConfiguration()
		return c.json(configurationResponseSchema.parse(configuration), HTTP_STATUS.OK)
	})
	.openapi(saveAiProviderConfigurationRoute, async (c) => {
		const input = c.req.valid("json")
		annotate(c, {
			"ai.text.provider": input.text.providerId,
			"ai.text.model": input.text.modelId,
			"ai.embedding.provider": input.embedding.providerId,
			"ai.embedding.model": input.embedding.modelId,
		})
		const configuration = await service.saveConfiguration(input, annotator(c))
		return c.json(configurationResponseSchema.parse(configuration), HTTP_STATUS.OK)
	})
	.openapi(discoverAiProviderModelsRoute, async (c) => {
		const input = c.req.valid("json")
		annotate(c, { "gen_ai.provider.name": input.providerId })
		const models = await service.discoverModels(input)
		return c.json(modelDiscoveryResponseSchema.parse({ models }), HTTP_STATUS.OK)
	})
