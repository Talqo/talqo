import { app } from "@/app.ts"
import { describe, expect, it } from "bun:test"

describe("agent routes", () => {
	it("requires authentication to list agents", async () => {
		expect((await app.request("/api/agents")).status).toBe(401)
	})

	it("requires authentication to read a single agent", async () => {
		expect((await app.request("/api/agents/any-id")).status).toBe(401)
	})

	it("requires authentication to create an agent", async () => {
		const response = await app.request("/api/agents", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Docs helper" }),
		})

		expect(response.status).toBe(401)
	})

	it("requires authentication to update an agent", async () => {
		const response = await app.request("/api/agents/any-id", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Renamed" }),
		})

		expect(response.status).toBe(401)
	})

	it("requires authentication to delete an agent", async () => {
		expect((await app.request("/api/agents/any-id", { method: "DELETE" })).status).toBe(401)
	})
})
