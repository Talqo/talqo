import type { Context } from "hono"

import { APICallError } from "@ai-sdk/provider"
import { describe, expect, it, spyOn } from "bun:test"

import { app, handleError } from "./app.ts"
import { isAccessPolicy } from "./http/access.ts"

describe("api", () => {
	it("reports its health", async () => {
		const response = await app.request("/health")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ status: "ok" })
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

	it("redacts provider call errors in logs", async () => {
		using logged = spyOn(console, "error").mockImplementation(() => {})
		let response: Response | undefined
		const context = {
			json: (data: unknown, status: number, headers?: Record<string, string>) => {
				response = new Response(JSON.stringify(data), { headers, status })
				return response
			},
		}
		await handleError(
			new APICallError({
				message: "Internal error encountered.",
				url: "https://provider.invalid/stream",
				requestBodyValues: { contents: [{ secret: "must-not-leak" }] },
				statusCode: 500,
				responseBody: '{"error":{"message":"Internal error encountered."}}',
			}),
			context as unknown as Context,
		)

		expect(response?.status).toBe(500)
		expect(JSON.stringify(logged.mock.calls)).not.toContain("must-not-leak")
	})

	it("declares an access policy on every endpoint", () => {
		const endpoints = app.routes.filter((route) => route.method !== "ALL")
		const withoutPolicy = endpoints
			.filter(
				(endpoint) =>
					!endpoints.some(
						(route) =>
							route.method === endpoint.method && route.path === endpoint.path && isAccessPolicy(route.handler),
					),
			)
			.map((route) => `${route.method} ${route.path}`)

		expect(endpoints.length).toBeGreaterThan(0)
		expect([...new Set(withoutPolicy)]).toEqual([])
	})
})
