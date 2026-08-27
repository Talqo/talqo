import type { Context } from "hono"

import { describe, expect, it, spyOn } from "bun:test"

import { app, handleError } from "./app.ts"
import { createOpenApiDocument } from "./openapi.ts"

describe("api", () => {
	it("reports its health", async () => {
		const response = await app.request("/health")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ status: "ok" })
	})

	it("rejects malformed JSON bodies with a shared error shape", async () => {
		const response = await app.request("/api/auth/login", {
			body: "{",
			headers: { "Content-Type": "application/json" },
			method: "POST",
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: "Malformed JSON body" })
	})

	it("accepts an empty JSON-typed body on the bodyless logout route", async () => {
		const response = await app.request("/api/auth/logout", {
			headers: { "Content-Length": "0", "Content-Type": "application/json" },
			method: "POST",
		})

		expect(response.status).toBe(204)
	})

	it("logs unexpected errors and keeps the response generic", async () => {
		using _ = spyOn(console, "error").mockImplementation(() => {})

		let response: Response | undefined
		const context = {
			json: (data: unknown, status: number) => {
				response = new Response(JSON.stringify(data), {
					headers: { "Content-Type": "application/json" },
					status,
				})
				return response
			},
			newResponse: (body: ConstructorParameters<typeof Response>[0], source: Response) =>
				new Response(body, { headers: source.headers, status: source.status }),
		}

		handleError(new Error("boom"), context as unknown as Context)

		expect(response?.status).toBe(500)
		expect(await response?.json()).toEqual({ error: "Internal server error" })
		expect(console.error).toHaveBeenCalled()
	})

	it("passes through responses carried by response-bearing errors", () => {
		using _ = spyOn(console, "error").mockImplementation(() => {})

		const carried = new Response(JSON.stringify({ error: "Payment required" }), {
			headers: { "Content-Type": "application/json" },
			status: 402,
		})
		const error = Object.assign(new Error("carried"), { getResponse: () => carried })

		const response = handleError(error, {
			newResponse: (body: ConstructorParameters<typeof Response>[0], source: Response) =>
				new Response(body, { headers: source.headers, status: source.status }),
		} as unknown as Context)

		expect(response.status).toBe(402)
		expect(console.error).not.toHaveBeenCalled()
	})

	it("describes every route through OpenAPI 3.1.1", () => {
		expect("getOpenAPI31Document" in app).toBe(true)

		const document = createOpenApiDocument()
		const paths = document.paths ?? {}

		expect(document.openapi).toBe("3.1.1")
		expect(Object.keys(paths).toSorted()).toEqual(
			[
				"/api/access",
				"/api/ai-provider-configuration",
				"/api/ai-provider-models/discover",
				"/api/ai-providers",
				"/api/agents",
				"/api/agents/{agentId}",
				"/api/agents/{agentId}/embed-token/refresh",
				"/api/agents/{agentId}/files",
				"/api/agents/{agentId}/files/{fileName}",
				"/api/auth/login",
				"/api/auth/logout",
				"/api/auth/session",
				"/api/invitations",
				"/api/invitations/redeem",
				"/api/me",
				"/api/me/password",
				"/api/me/password/forced",
				"/api/me/permissions",
				"/api/permission-grants",
				"/api/permission-grants/{id}",
				"/api/setup",
				"/api/users",
				"/api/users/{userId}/password",
				"/health",
			].toSorted(),
		)

		const operations = Object.values(paths).flatMap((operationsByMethod) => Object.values(operationsByMethod))
		for (const operation of operations) {
			expect(operation.operationId).toBeDefined()
		}

		const operationIds = operations.flatMap((operation) => operation.operationId ?? [])
		expect(new Set(operationIds).size).toBe(operationIds.length)
		expect(operationIds.every((operationId) => operationId.length > 0)).toBe(true)
	})
})
