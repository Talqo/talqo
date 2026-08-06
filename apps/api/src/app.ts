import type { AuthedVariables } from "@/http/require-auth.ts"

import { requireAuth } from "@/http/require-auth.ts"
import { identityRoutes } from "@/modules/identity/identity.routes.ts"
import { rolesRoutes } from "@/modules/roles/roles.routes.ts"
import { Hono } from "hono"

export const app = new Hono<{ Variables: AuthedVariables }>()
	.get("/health", (context) => context.json({ status: "ok" }))
	.use("*", requireAuth)
	.route("/", identityRoutes)
	.route("/", rolesRoutes)
