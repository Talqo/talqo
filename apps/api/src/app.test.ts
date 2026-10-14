import type { Context } from "hono"

import { APICallError } from "@ai-sdk/provider"
import { OpenAPIHono } from "@hono/zod-openapi"
import { describe, expect, it, spyOn } from "bun:test"

import { app, handleError } from "./app.ts"
import { access, isAccessPolicy, requireAccessPolicy } from "./http/access.ts"

const respond = () =>
	({
		json: (data: unknown, status: number, headers?: Record<string, string>) =>
			new Response(JSON.stringify(data), { headers, status }),
	}) as unknown as Context

const carriedError = (response: () => Response) => Object.assign(new Error("carried"), { getResponse: response })

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
		expect(logged.mock.calls[0]?.[0]).toBe("provider.call.failed")
		expect(JSON.stringify(logged.mock.calls)).not.toContain("must-not-leak")
	})

	// Nothing currently throws response-carrying errors, but the branch keeps Hono's default
	// errorHandler semantics for any middleware that starts doing so; spec the transformation here.
	describe("response-bearing errors", () => {
		it("passes a non-error response through untouched", async () => {
			const carried = new Response(null, { headers: { Location: "/login" }, status: 302 })

			expect(
				await handleError(
					carriedError(() => carried),
					{} as Context,
				),
			).toBe(carried)
		})

		for (const { status, body, forwarded, code } of [
			{ status: 402, body: { error: "Payment required" }, forwarded: ["Retry-After", "30"], code: "request-failed" },
			{
				status: 403,
				body: { code: "permission-denied", type: "https://docs.talqo.chat/problems#permission-denied" },
				forwarded: ["Set-Cookie", "session=; Max-Age=0"],
				code: "permission-denied",
			},
		] as const) {
			it(`normalizes a carried ${status} response without logging, forwarding ${forwarded[0]}`, async () => {
				using _ = spyOn(console, "error").mockImplementation(() => {})
				const carried = new Response(JSON.stringify(body), {
					headers: { "Content-Type": "application/json", [forwarded[0]]: forwarded[1] },
					status,
				})

				const response = await handleError(
					carriedError(() => carried),
					respond(),
				)

				expect(response.status).toBe(status)
				expect(response.headers.get("Content-Type")).toBe("application/problem+json")
				expect(response.headers.get(forwarded[0])).toBe(forwarded[1])
				expect(await response.json()).toEqual({ code, type: `https://docs.talqo.chat/problems#${code}` })
				expect(console.error).not.toHaveBeenCalled()
			})
		}

		it("normalizes a carried response whose body cannot be cloned", async () => {
			const carried = new Response("consumed", { status: 409 })
			await carried.text()

			const response = await handleError(
				carriedError(() => carried),
				respond(),
			)

			expect(response.status).toBe(409)
			expect(await response.json()).toEqual({
				code: "request-failed",
				type: "https://docs.talqo.chat/problems#request-failed",
			})
		})

		it("falls back to a generic problem when the response factory throws", async () => {
			using _ = spyOn(console, "error").mockImplementation(() => {})

			const response = await handleError(
				carriedError(() => {
					throw new Error("response failed")
				}),
				respond(),
			)

			expect(response.status).toBe(500)
			expect(await response.json()).toEqual({
				code: "internal-server-error",
				type: "https://docs.talqo.chat/problems#internal-server-error",
			})
			expect(console.error).toHaveBeenCalled()
		})
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

	it("refuses an endpoint registered without an access policy", async () => {
		using _ = spyOn(console, "error").mockImplementation(() => {})
		const probe = new OpenAPIHono()
		probe.use("*", requireAccessPolicy)
		probe.get("/undeclared", (c) => c.text("reachable"))
		probe.get("/declared", access.public.middleware, (c) => c.text("reachable"))

		const undeclared = await probe.request("/undeclared")

		expect(undeclared.status).toBe(500)
		expect(await undeclared.json()).toMatchObject({ code: "internal-server-error" })
		expect(console.error).toHaveBeenCalledWith("route.access_policy_missing", { method: "GET", path: "/undeclared" })
		expect((await probe.request("/declared")).status).toBe(200)
	})
})
