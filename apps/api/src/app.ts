import type { AuthedVariables } from "@/http/require-auth.ts"
import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import { getHealthRoute } from "@/http/health.contract.ts"
import { rejectMalformedJson, rejectOversizedBody } from "@/http/json-body.ts"
import { PROBLEM_CODES, problemDetailsSchema, problemResponse } from "@/http/problem.ts"
import { API_PREFIX, requireAuth } from "@/http/require-auth.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { agentFilesRoutes } from "@/modules/agent-files/agent-files.routes.ts"
import { agentRoutes } from "@/modules/agent/agent.routes.ts"
import { aiProviderRoutes } from "@/modules/ai-provider/ai-provider.routes.ts"
import { identityRoutes } from "@/modules/identity/identity.routes.ts"
import { rolesRoutes } from "@/modules/roles/roles.routes.ts"
import { widgetConfigRoutes, widgetRoutes } from "@/modules/widget/widget.routes.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { cors } from "hono/cors"

const CORS_MAX_AGE_SECONDS = 86_400

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
app.use("*", rejectOversizedBody)
app.use("*", rejectMalformedJson)
// Ahead of requireAuth, so a preflight is not answered with a 401. Scoped to the public
// config path: `origin: "*"` forbids credentials, but wider would be a CSRF hole (ADR-0013).
app.use(
	`${API_PREFIX}/widget-config/*`,
	cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], maxAge: CORS_MAX_AGE_SECONDS }),
)
app.use("*", requireAuth)
const api = new OpenAPIHono<{ Variables: AuthedVariables }>()
api.route("/", aiProviderRoutes)
api.route("/", identityRoutes)
api.route("/", rolesRoutes)
api.route("/agents", agentRoutes)
api.route("/widgets", widgetRoutes)
api.route("/widget-config", widgetConfigRoutes)
api.route("/agents", agentFilesRoutes)
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
			if (response.status < MIN_ERROR_STATUS || response.status > MAX_ERROR_STATUS) return response

			let parsed: unknown
			try {
				parsed = await response.clone().json()
			} catch {
				parsed = undefined
			}
			const problem = problemDetailsSchema.safeParse(parsed)
			const code = problem.success ? problem.data.code : PROBLEM_CODES.REQUEST_FAILED
			const normalized = problemResponse(context, code, response.status as ContentfulStatusCode)
			for (const [name, value] of response.headers) {
				if (name.toLowerCase() !== "content-type") normalized.headers.append(name, value)
			}
			return normalized
		}
	}

	console.error(error)
	return problemResponse(context, PROBLEM_CODES.INTERNAL_SERVER_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR)
}

app.onError(handleError)
