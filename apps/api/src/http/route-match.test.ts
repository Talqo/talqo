import { describe, expect, it } from "bun:test"
import { Hono } from "hono"

import { hasMatchedRoute, matchedRoutePath } from "./route-match.ts"

function probe() {
	const seen: Array<{ matched: boolean; path: string | null }> = []
	const app = new Hono()
	app.use("*", async (context, next) => {
		await next()
		seen.push({ matched: hasMatchedRoute(context), path: matchedRoutePath(context) })
	})
	app.get("/known/:id", (context) => context.text("ok"))
	return { app, seen }
}

describe("route matching", () => {
	it("counts only endpoint routes, not the wildcard middleware", async () => {
		const { app, seen } = probe()

		await app.request("/known/1")
		await app.request("/missing")

		expect(seen).toEqual([
			{ matched: true, path: "/known/:id" },
			{ matched: false, path: null },
		])
	})

	it("treats a path matched only by another method as unmatched", async () => {
		const { app, seen } = probe()

		await app.request("/known/1", { method: "POST" })

		expect(seen).toEqual([{ matched: false, path: null }])
	})
})
