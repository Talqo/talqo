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

	it("rejects malformed JSON bodies with problem details", async () => {
		const response = await app.request("/api/auth/login", {
			body: "{",
			headers: { "Content-Type": "application/json" },
			method: "POST",
		})

		expect(response.status).toBe(400)
		expect(response.headers.get("Content-Type")).toBe("application/problem+json")
		expect(await response.json()).toEqual({
			code: "malformed-json",
			type: "https://docs.talqo.chat/problems#malformed-json",
		})
	})

	it("returns problem details for unknown routes", async () => {
		const responses = [
			await app.request("/missing"),
			await app.request("/api/missing"),
			await app.request("/api/missing", {
				body: "{",
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		]
		const bodies = await Promise.all(responses.map((response) => response.json()))
		for (const [index, response] of responses.entries()) {
			expect(response.status).toBe(404)
			expect(response.headers.get("Content-Type")).toBe("application/problem+json")
			expect(bodies[index]).toEqual({
				code: "route-not-found",
				type: "https://docs.talqo.chat/problems#route-not-found",
			})
		}
	})

	it("returns problem details when authentication is required", async () => {
		const response = await app.request("/api/access")

		expect(response.status).toBe(401)
		expect(response.headers.get("Content-Type")).toBe("application/problem+json")
		expect(await response.json()).toEqual({
			code: "authentication-required",
			type: "https://docs.talqo.chat/problems#authentication-required",
		})
	})

	it("returns problem details for invalid requests", async () => {
		const response = await app.request("/api/auth/login", {
			body: JSON.stringify({}),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		})

		expect(response.status).toBe(400)
		expect(response.headers.get("Content-Type")).toBe("application/problem+json")
		expect(await response.json()).toEqual({
			code: "invalid-request",
			type: "https://docs.talqo.chat/problems#invalid-request",
		})
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
			json: (data: unknown, status: number, headers?: Record<string, string>) => {
				response = new Response(JSON.stringify(data), {
					headers,
					status,
				})
				return response
			},
			newResponse: (body: ConstructorParameters<typeof Response>[0], source: Response) =>
				new Response(body, { headers: source.headers, status: source.status }),
		}

		await handleError(new Error("boom"), context as unknown as Context)

		expect(response?.status).toBe(500)
		expect(response?.headers.get("Content-Type")).toBe("application/problem+json")
		expect(await response?.json()).toEqual({
			code: "internal-server-error",
			type: "https://docs.talqo.chat/problems#internal-server-error",
		})
		expect(console.error).toHaveBeenCalled()
	})

	it("normalizes responses carried by response-bearing errors", async () => {
		using _ = spyOn(console, "error").mockImplementation(() => {})

		const carried = new Response(JSON.stringify({ error: "Payment required" }), {
			headers: { "Content-Type": "application/json" },
			status: 402,
		})
		const error = Object.assign(new Error("carried"), { getResponse: () => carried })

		const response = await handleError(error, {
			json: (data: unknown, status: number, headers?: Record<string, string>) =>
				new Response(JSON.stringify(data), { headers, status }),
		} as unknown as Context)

		expect(response.status).toBe(402)
		expect(response.headers.get("Content-Type")).toBe("application/problem+json")
		expect(await response.json()).toEqual({
			code: "request-failed",
			type: "https://docs.talqo.chat/problems#request-failed",
		})
		expect(console.error).not.toHaveBeenCalled()
	})

	it("reserializes valid problems carried by response-bearing errors", async () => {
		const carried = new Response(
			JSON.stringify({
				code: "permission-denied",
				type: "https://docs.talqo.chat/problems#permission-denied",
			}),
			{ headers: { "Content-Type": "application/json" }, status: 403 },
		)
		const error = Object.assign(new Error("carried"), { getResponse: () => carried })

		const response = await handleError(error, {
			json: (data: unknown, status: number, headers?: Record<string, string>) =>
				new Response(JSON.stringify(data), { headers, status }),
		} as unknown as Context)

		expect(response.status).toBe(403)
		expect(response.headers.get("Content-Type")).toBe("application/problem+json")
		expect(await response.json()).toEqual({
			code: "permission-denied",
			type: "https://docs.talqo.chat/problems#permission-denied",
		})
	})

	it("normalizes response-bearing errors when their response cannot be cloned", async () => {
		const carried = new Response("consumed", { status: 409 })
		await carried.text()
		const error = Object.assign(new Error("carried"), { getResponse: () => carried })

		const response = await handleError(error, {
			json: (data: unknown, status: number, headers?: Record<string, string>) =>
				new Response(JSON.stringify(data), { headers, status }),
		} as unknown as Context)

		expect(response.status).toBe(409)
		expect(await response.json()).toEqual({
			code: "request-failed",
			type: "https://docs.talqo.chat/problems#request-failed",
		})
	})

	it("normalizes a response-bearing error whose response factory throws", async () => {
		using _ = spyOn(console, "error").mockImplementation(() => {})
		const error = Object.assign(new Error("carried"), {
			getResponse: () => {
				throw new Error("response failed")
			},
		})

		const response = await handleError(error, {
			json: (data: unknown, status: number, headers?: Record<string, string>) =>
				new Response(JSON.stringify(data), { headers, status }),
		} as unknown as Context)

		expect(response.status).toBe(500)
		expect(await response.json()).toEqual({
			code: "internal-server-error",
			type: "https://docs.talqo.chat/problems#internal-server-error",
		})
		expect(console.error).toHaveBeenCalled()
	})

	it("registers API endpoints with method-specific routes only", () => {
		const wildcardApiRoutes = app.routes
			.filter((route) => route.method === "ALL" && route.path.startsWith("/api/"))
			.map((route) => route.path)

		expect(wildcardApiRoutes).toEqual(["/api/*", "/api/*"])
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

		const problemSchema = document.components?.schemas?.ProblemDetails as {
			oneOf?: Array<{
				additionalProperties?: boolean
				properties?: { code?: { const?: string }; type?: { const?: string } }
			}>
		}
		expect(problemSchema.oneOf).toHaveLength(27)
		for (const schema of problemSchema.oneOf ?? []) {
			expect(schema.additionalProperties).toBe(false)
			expect(schema.properties?.type?.const).toBe(`https://docs.talqo.chat/problems#${schema.properties?.code?.const}`)
		}

		const loginBadRequest = paths["/api/auth/login"]?.post?.responses?.["400"] as {
			content?: {
				"application/problem+json"?: {
					schema?: { oneOf?: Array<{ properties?: { code?: { const?: string }; type?: { const?: string } } }> }
				}
			}
		}
		const loginProblems = loginBadRequest.content?.["application/problem+json"]?.schema?.oneOf ?? []
		expect(loginProblems.map((schema) => schema.properties?.code?.const)).toEqual(
			expect.arrayContaining(["invalid-request", "malformed-json"]),
		)
		expect(loginProblems).not.toBeEmpty()
		expect(loginProblems.map((schema) => schema.properties?.type?.const)).toEqual(
			loginProblems.map((schema) => `https://docs.talqo.chat/problems#${schema.properties?.code?.const}`),
		)
	})
})
