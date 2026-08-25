import type { AuthedVariables } from "@/http/require-auth.ts"
import type { Context } from "hono"

import { getHealthRoute } from "@/http/health.contract.ts"
import { rejectMalformedJson } from "@/http/json-body.ts"
import { API_PREFIX, requireAuth } from "@/http/require-auth.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { agentRoutes } from "@/modules/agent/agent.routes.ts"
import { aiProviderRoutes } from "@/modules/ai-provider/ai-provider.routes.ts"
import { identityRoutes } from "@/modules/identity/identity.routes.ts"
import { rolesRoutes } from "@/modules/roles/roles.routes.ts"
import { widgetConfigRoutes, widgetRoutes } from "@/modules/widget/widget.routes.ts"
import { OpenAPIHono, z } from "@hono/zod-openapi"
import { cors } from "hono/cors"

const CORS_MAX_AGE_SECONDS = 86_400

export const app = new OpenAPIHono<{ Variables: AuthedVariables }>({
	defaultHook: (result, context) => {
		if (!result.success) {
			return context.json({ error: z.prettifyError(result.error) }, HTTP_STATUS.BAD_REQUEST)
		}
	},
})

app.openAPIRegistry.registerComponent("securitySchemes", "SessionCookie", {
	in: "cookie",
	name: "session",
	type: "apiKey",
})

app.openapi(getHealthRoute, (context) => context.json({ status: "ok" } as const, HTTP_STATUS.OK))
app.use("*", rejectMalformedJson)
// Ahead of requireAuth: a preflight that hits the auth gate gets a 401 and the
// browser abandons the real request. Scoped to the public config path only --
// permissive CORS over the cookie-authenticated routes would be a CSRF hole.
// `origin: "*"` is safe here precisely because it forbids credentialed requests,
// and the payload is already public in every embedding page's source (ADR-0011).
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
app.route(API_PREFIX, api)
// Mirrors Hono's default errorHandler pass-through for response-carrying errors,
// hardened by validating the produced value is a real Response, and keeps a
// generic body with the original error logged for everything else.
export function handleError(error: Error, context: Context): Response {
	if ("getResponse" in error && typeof error.getResponse === "function") {
		const response: unknown = error.getResponse()
		if (response instanceof Response) {
			return context.newResponse(response.body, response)
		}
	}

	console.error(error)
	return context.json({ error: "Internal server error" }, HTTP_STATUS.INTERNAL_SERVER_ERROR)
}

app.onError(handleError)
