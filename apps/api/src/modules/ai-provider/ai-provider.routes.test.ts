import { app } from "@/app.ts"
import { describe, expect, it } from "bun:test"

describe("AI provider routes", () => {
	it("requires authentication for provider metadata", async () => {
		const response = await app.request("/api/ai-providers")

		expect(response.status).toBe(401)
	})

	it("requires authentication for configuration", async () => {
		const response = await app.request("/api/ai-provider-configuration")

		expect(response.status).toBe(401)
	})

	it("requires authentication for discovery", async () => {
		const response = await app.request("/api/ai-provider-models/discover", { method: "POST" })

		expect(response.status).toBe(401)
	})
})
