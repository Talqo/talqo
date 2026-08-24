import type { AuthedVariables } from "@/http/require-auth.ts"
import type { Context } from "hono"

import { getHealthRoute } from "@/http/health.contract.ts"
import { rejectMalformedJson } from "@/http/json-body.ts"
import { API_PREFIX, requireAuth } from "@/http/require-auth.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { aiProviderRoutes } from "@/modules/ai-provider/ai-provider.routes.ts"
import { identityRoutes } from "@/modules/identity/identity.routes.ts"
import { rolesRoutes } from "@/modules/roles/roles.routes.ts"
import { OpenAPIHono, z } from "@hono/zod-openapi"

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
app.use("*", requireAuth)
const api = new OpenAPIHono<{ Variables: AuthedVariables }>()
api.route("/", aiProviderRoutes)
api.route("/", identityRoutes)
api.route("/", rolesRoutes)
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
