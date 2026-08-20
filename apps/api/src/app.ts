import type { AuthedVariables } from "@/http/require-auth.ts"

import { requireAuth } from "@/http/require-auth.ts"
import { agentRoutes } from "@/modules/agent/agent.routes.ts"
import { identityRoutes } from "@/modules/identity/identity.routes.ts"
import { rolesRoutes } from "@/modules/roles/roles.routes.ts"
import { widgetRoutes } from "@/modules/widget/widget.routes.ts"
import { Hono } from "hono"
import { cors } from "hono/cors"

const CORS_MAX_AGE_SECONDS = 86_400

export const app = new Hono<{ Variables: AuthedVariables }>()
	.get("/health", (context) => context.json({ status: "ok" }))
	// Ahead of requireAuth: a preflight that hits the auth gate gets a 401 and the
	// browser abandons the real request. Scoped to the public config path only --
	// permissive CORS over the cookie-authenticated routes would be a CSRF hole.
	// `origin: "*"` is safe here precisely because it forbids credentialed requests,
	// and the payload is already public in every embedding page's source (ADR-0011).
	.use("/api/widget-config/*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], maxAge: CORS_MAX_AGE_SECONDS }))
	.use("*", requireAuth)
	.route("/", identityRoutes)
	.route("/", rolesRoutes)
	.route("/", agentRoutes)
	.route("/", widgetRoutes)
