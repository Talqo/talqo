import type { AuthedVariables } from "@/http/require-auth.ts"
import type { Context } from "hono"

import { getHealthRoute } from "@/http/health.contract.ts"
import { rejectMalformedJson } from "@/http/json-body.ts"
import { PROBLEM_CODES, problemDetailsSchema, problemResponse } from "@/http/problem.ts"
import { API_PREFIX, requireAuth } from "@/http/require-auth.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { agentRoutes } from "@/modules/agent/agent.routes.ts"
import { aiProviderRoutes } from "@/modules/ai-provider/ai-provider.routes.ts"
import { identityRoutes } from "@/modules/identity/identity.routes.ts"
import { rolesRoutes } from "@/modules/roles/roles.routes.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

const MIN_ERROR_STATUS = 400
const MAX_ERROR_STATUS = 599

export const app = new OpenAPIHono<{ Variables: AuthedVariables }>({
	defaultHook: (result, context) => {
		if (!result.success) {
			return problemResponse(context, PROBLEM_CODES.INVALID_REQUEST, HTTP_STATUS.BAD_REQUEST)
		}
	},
})

app.openAPIRegistry.registerComponent("securitySchemes", "SessionCookie", {
	in: "cookie",
	name: "session",
	type: "apiKey",
})

app.openapi(getHealthRoute, (context) => context.json({ status: "ok" } as const, HTTP_STATUS.OK))
app.use(`${API_PREFIX}/*`, rejectMalformedJson)
app.use(`${API_PREFIX}/*`, requireAuth)
const api = new OpenAPIHono<{ Variables: AuthedVariables }>()
api.route("/", aiProviderRoutes)
api.route("/", identityRoutes)
api.route("/", rolesRoutes)
api.route("/agents", agentRoutes)
app.route(API_PREFIX, api)
app.notFound((context) => problemResponse(context, PROBLEM_CODES.ROUTE_NOT_FOUND, HTTP_STATUS.NOT_FOUND))
// Mirrors Hono's default errorHandler pass-through for response-carrying errors,
// hardened by validating the produced value is a real Response, and keeps a
// generic body with the original error logged for everything else.
export async function handleError(error: Error, context: Context): Promise<Response> {
	if ("getResponse" in error && typeof error.getResponse === "function") {
		let response: unknown
		try {
			response = error.getResponse()
		} catch (responseError) {
			console.error(responseError)
			return problemResponse(context, PROBLEM_CODES.INTERNAL_SERVER_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR)
		}
		if (response instanceof Response) {
			let parsed: unknown
			try {
				parsed = await response.clone().json()
			} catch {
				parsed = undefined
			}
			const problem = problemDetailsSchema.safeParse(parsed)
			const code = problem.success ? problem.data.code : PROBLEM_CODES.REQUEST_FAILED
			if (response.status >= MIN_ERROR_STATUS && response.status <= MAX_ERROR_STATUS) {
				return problemResponse(context, code, response.status as never)
			}
		}
	}

	console.error(error)
	return problemResponse(context, PROBLEM_CODES.INTERNAL_SERVER_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR)
}

app.onError(handleError)
