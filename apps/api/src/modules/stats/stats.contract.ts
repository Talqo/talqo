import { access } from "@/http/access.ts"
import { problemResponse } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { createRoute, z } from "@hono/zod-openapi"

const STATS_MAX_DAYS = 365
const statsQuerySchema = z.object({
	days: z.coerce.number().int().min(1).max(STATS_MAX_DAYS).optional(),
	agentId: z.string().optional(),
})
const statsDailyPointSchema = z.object({
	date: z.string(),
	conversations: z.number().int(),
	messages: z.number().int(),
	inputTokens: z.number().int(),
	outputTokens: z.number().int(),
})
const statsTotalsSchema = z.object({
	conversations: z.number().int(),
	messages: z.number().int(),
	inputTokens: z.number().int(),
	outputTokens: z.number().int(),
})
const statsAgentTotalsSchema = statsTotalsSchema.extend({
	agentId: z.string(),
	agentName: z.string(),
})
const statsAgentDailyPointSchema = statsDailyPointSchema.extend({
	agentId: z.string(),
})
const statsActiveConversationsSchema = z.object({
	agentId: z.string(),
	conversations: z.number().int(),
})
export const statsOverviewResponseSchema = z.object({
	overview: z.object({
		days: z.number().int(),
		totals: statsTotalsSchema,
		daily: z.array(statsDailyPointSchema),
		agentDaily: z.array(statsAgentDailyPointSchema),
		agents: z.array(statsAgentTotalsSchema),
		active: z.array(statsActiveConversationsSchema),
		activeWindowMinutes: z.number().int(),
	}),
})

export const statsOverviewRoute = createRoute({
	method: "get",
	path: "/overview",
	operationId: "getStatsOverview",
	tags: ["Stats"],
	...access.permission(roles.Permission.AgentsRead),
	request: { query: statsQuerySchema },
	responses: {
		200: {
			content: { "application/json": { schema: statsOverviewResponseSchema } },
			description: "Conversation and usage statistics",
		},
		400: problemResponse([PROBLEM_CODES.INVALID_REQUEST]),
		401: problemResponse([PROBLEM_CODES.AUTHENTICATION_REQUIRED]),
		403: problemResponse([PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED, PROBLEM_CODES.PERMISSION_DENIED]),
		500: problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR]),
	},
})
