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
		const configuration = await service.saveConfiguration(c.req.valid("json"))
		return c.json(configurationResponseSchema.parse(configuration), HTTP_STATUS.OK)
	})
	.openapi(discoverAiProviderModelsRoute, async (c) => {
		const models = await service.discoverModels(c.req.valid("json"))
		return c.json(modelDiscoveryResponseSchema.parse({ models }), HTTP_STATUS.OK)
	})
