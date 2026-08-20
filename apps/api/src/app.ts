import type { AuthedVariables } from "@/http/require-auth.ts"

import { getHealthRoute } from "@/http/health.contract.ts"
import { rejectMalformedJson } from "@/http/json-body.ts"
import { requireAuth } from "@/http/require-auth.ts"
import { HTTP_STATUS } from "@/http/status.ts"
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
app.route("/", identityRoutes)
app.route("/", rolesRoutes)
app.onError((error, context) => {
	if ("getResponse" in error && typeof error.getResponse === "function") {
		const response = error.getResponse() as Response
		return context.newResponse(response.body, response)
	}

	console.error(error)
	return context.json({ error: "Internal server error" }, HTTP_STATUS.INTERNAL_SERVER_ERROR)
})
