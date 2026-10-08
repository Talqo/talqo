import { app as rootApp } from "@/app.ts"
import { describe, expect, it } from "bun:test"

describe("stats routes", () => {
	it("rejects an unauthenticated GET /api/stats/overview request", async () => {
		const response = await rootApp.request("/api/stats/overview")
		expect(response.status).toBe(401)
	})
})
