import { app } from "@/app.ts"
import { describe, expect, it } from "bun:test"

describe("agents routes", () => {
	it.each([
		["GET", "/api/agents"],
		["POST", "/api/agents"],
		["GET", "/api/agents/some-id"],
		["PATCH", "/api/agents/some-id"],
		["DELETE", "/api/agents/some-id"],
		["GET", "/api/agents/some-id/files"],
		["POST", "/api/agents/some-id/files"],
		["PATCH", "/api/agents/some-id/files/some-file"],
		["DELETE", "/api/agents/some-id/files/some-file"],
	])("rejects an unauthenticated %s %s", async (method, path) => {
		const response = await app.request(path, { method })

		expect(response.status).toBe(401)
	})
})
