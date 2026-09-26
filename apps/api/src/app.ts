import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import { requireAccessPolicy } from "@/http/access.ts"
import { getHealthRoute } from "@/http/health.contract.ts"
import { rejectMalformedJson, rejectOversizedBody } from "@/http/json-body.ts"
import { PROBLEM_CODES, problemDetailsSchema, problemResponse } from "@/http/problem.ts"
import { API_PREFIX } from "@/http/route-match.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { agentRoutes } from "@/modules/agent/agent.routes.ts"
import { aiProviderRoutes } from "@/modules/ai-provider/ai-provider.routes.ts"
import { createConversationRoutes, statsRoutes, type ChatBindings } from "@/modules/conversation/conversation.routes.ts"
import { embedConfigRoutes, embedRoutes, legacyWidgetConfigRoutes } from "@/modules/embed/embed.routes.ts"
import { identityRoutes } from "@/modules/identity/identity.routes.ts"
import { agentFilesRoutes } from "@/modules/knowledge-base/knowledge-base.routes.ts"
import { mcpServerRoutes } from "@/modules/mcp/mcp.routes.ts"
import { rolesRoutes } from "@/modules/roles/roles.routes.ts"
import { APICallError } from "@ai-sdk/provider"
import { OpenAPIHono } from "@hono/zod-openapi"
import { cors } from "hono/cors"

const CORS_MAX_AGE_SECONDS = 86_400

const MIN_ERROR_STATUS = 400
const MAX_ERROR_STATUS = 599

export const app = new OpenAPIHono<{ Bindings: ChatBindings }>({
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
app.openAPIRegistry.registerComponent("securitySchemes", "ChatBearer", {
	type: "http",
	scheme: "bearer",
	bearerFormat: "UUID",
})
app.openAPIRegistry.register("ProblemDetails", problemDetailsSchema)

app.openapi(getHealthRoute, (context) => context.json({ status: "ok" } as const, HTTP_STATUS.OK))
app.use("*", rejectOversizedBody)
app.use("*", rejectMalformedJson)
// Ahead of route access policies, so preflights and 401s carry CORS headers. Scoped to the public
// config path: `origin: "*"` forbids credentials, but wider would be a CSRF hole (ADR-0013).
app.use(
	`${API_PREFIX}/embed-config/*`,
	cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], maxAge: CORS_MAX_AGE_SECONDS }),
)
app.use(
	`${API_PREFIX}/widget-config/*`,
	cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], maxAge: CORS_MAX_AGE_SECONDS }),
)
app.use(
	`${API_PREFIX}/chat/*`,
	cors({
		origin: "*",
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Authorization", "Content-Type"],
		maxAge: CORS_MAX_AGE_SECONDS,
	}),
)
app.use("*", requireAccessPolicy)
const api = new OpenAPIHono<{ Bindings: ChatBindings }>()
api.route("/", aiProviderRoutes)
api.route("/", identityRoutes)
api.route("/", rolesRoutes)
api.route("/agents", agentRoutes)
api.route("/embeds", embedRoutes)
api.route("/embed-config", embedConfigRoutes)
api.route("/widget-config", legacyWidgetConfigRoutes)
api.route("/chat", createConversationRoutes())
api.route("/stats", statsRoutes)
api.route("/agents", agentFilesRoutes)
api.route("/agents", mcpServerRoutes)
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

	if (APICallError.isInstance(error)) {
		console.error("provider.call.failed", {
			message: error.message,
			statusCode: error.statusCode,
			url: error.url,
			isRetryable: error.isRetryable,
		})
	} else {
		console.error(error)
	}
	return problemResponse(context, PROBLEM_CODES.INTERNAL_SERVER_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR)
}

app.onError(handleError)
