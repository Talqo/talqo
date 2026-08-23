import { app } from "@/app.ts"
import { describe, expect, it } from "bun:test"

describe("agent routes", () => {
	it.each([
		["GET", "/api/agents"],
		["POST", "/api/agents"],
	] as const)("rejects an unauthenticated %s %s request", async (method, path) => {
		const response = await app.request(path, { method })

		expect(response.status).toBe(401)
	})

	it("rejects an unauthenticated GET /api/agents/:id request", async () => {
		const response = await app.request(`/api/agents/${crypto.randomUUID()}`)

		expect(response.status).toBe(401)
	})

	it("rejects an unauthenticated PUT /api/agents/:id request", async () => {
		const response = await app.request(`/api/agents/${crypto.randomUUID()}`, { method: "PUT" })

		expect(response.status).toBe(401)
	})

	it("rejects an unauthenticated DELETE /api/agents/:id request", async () => {
		const response = await app.request(`/api/agents/${crypto.randomUUID()}`, { method: "DELETE" })

		expect(response.status).toBe(401)
	})

	it("rejects an unauthenticated POST /api/agents/:id/embed-token/refresh request", async () => {
		const response = await app.request(`/api/agents/${crypto.randomUUID()}/embed-token/refresh`, { method: "POST" })

		expect(response.status).toBe(401)
	})
})
