import { HTTP_STATUS } from "@/http/status.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import { statsOverviewResponseSchema, statsOverviewRoute } from "./stats.contract.ts"
import * as service from "./stats.service.ts"

const DEFAULT_STATS_DAYS = 30

export const statsRoutes = new OpenAPIHono().openapi(statsOverviewRoute, async (c) => {
	const { days } = c.req.valid("query")
	const overview = await service.getStatsOverview({ days: days ?? DEFAULT_STATS_DAYS })
	return c.json(statsOverviewResponseSchema.parse({ overview }), HTTP_STATUS.OK)
})
