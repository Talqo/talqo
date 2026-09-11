import type { Context } from "hono"

import { matchedRoutes } from "hono/route"

// Wildcard middleware runs before Hono's not-found decision; endpoint routes are method-specific.
export function hasMatchedRoute(context: Context): boolean {
	return matchedRoutes(context).some((route) => route.method !== "ALL")
}
