import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { describe, expect, it } from "bun:test"

import { annotate, createWideEvents, deferWideEvent, REQUEST_ID_HEADER, type WideEvent } from "./wide-event.ts"

function probe(write?: (event: WideEvent) => void) {
	const logged: WideEvent[] = []
	const app = new OpenAPIHono()
	app.use("*", createWideEvents(write ?? ((event) => logged.push(event))))
	app.get("/agents/:agentId", (c) => {
		annotate(c, { "user.id": "operator" })
		return c.json({ ok: true })
	})
	app.post("/denied", (c) => problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN))
	app.get("/boom", () => {
		throw new TypeError("secret detail")
	})
	app.onError((error, c) => {
		annotate(c, { "error.type": error.constructor.name })
		return problemResponse(c, PROBLEM_CODES.INTERNAL_SERVER_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR)
	})
	return { app, logged }
}

describe("wide events", () => {
	it("logs one event per request with route template, identity, and generated request ID", async () => {
		const { app, logged } = probe()
		const response = await app.request("/agents/agent-1?email=visitor@example.com")

		expect(response.status).toBe(200)
		expect(logged).toEqual([
			{
				"request.id": expect.any(String),
				"http.request.method": "GET",
				"http.route": "/agents/:agentId",
				"http.response.status_code": 200,
				duration_ms: expect.any(Number),
				"agent.id": "agent-1",
				"user.id": "operator",
			},
		])
		expect(response.headers.get(REQUEST_ID_HEADER)).toBe(logged[0]?.["request.id"] ?? null)
		expect(JSON.stringify(logged)).not.toContain("visitor@example.com")
	})

	it("keeps a safe inbound request ID and replaces an unsafe one", async () => {
		const { app, logged } = probe()
		await app.request("/agents/a", { headers: { [REQUEST_ID_HEADER]: "edge-123" } })
		await app.request("/agents/a", { headers: { [REQUEST_ID_HEADER]: "x".repeat(129) } })
		await app.request("/agents/a", { headers: { [REQUEST_ID_HEADER]: '"}{inject' } })

		expect(logged.map((event) => event["request.id"])).toEqual([
			"edge-123",
			expect.not.stringContaining("x".repeat(129)),
			expect.not.stringContaining("inject"),
		])
	})

	it("records problem codes, error classes, and unmatched routes", async () => {
		const { app, logged } = probe()
		await app.request("/denied", { method: "POST" })
		await app.request("/boom")
		await app.request("/missing")

		expect(logged).toEqual([
			expect.objectContaining({ "http.response.status_code": 403, "error.code": PROBLEM_CODES.PERMISSION_DENIED }),
			expect.objectContaining({
				"http.response.status_code": 500,
				"error.code": PROBLEM_CODES.INTERNAL_SERVER_ERROR,
				"error.type": "TypeError",
			}),
			expect.objectContaining({ "http.route": null, "http.response.status_code": 404 }),
		])
		expect(JSON.stringify(logged)).not.toContain("secret detail")
	})

	it("never logs credentials, cookies, or bodies", async () => {
		const { app, logged } = probe()
		await app.request("/denied", {
			method: "POST",
			headers: { Authorization: "Bearer bearer-secret", Cookie: "session=cookie-secret" },
			body: JSON.stringify({ text: "body-secret" }),
		})

		const serialized = JSON.stringify(logged)
		for (const secret of ["bearer-secret", "cookie-secret", "body-secret"]) expect(serialized).not.toContain(secret)
	})

	it("writes a deferred event once the streamed work settles", async () => {
		const logged: WideEvent[] = []
		const app = new OpenAPIHono()
		app.use(
			"*",
			createWideEvents((event) => logged.push(event)),
		)
		const work = Promise.withResolvers<void>()
		app.get("/stream", (c) => {
			deferWideEvent(c, work.promise)
			return c.body("streaming")
		})

		expect((await app.request("/stream")).status).toBe(200)
		expect(logged).toBeEmpty()
		work.reject(new Error("generation failed"))
		await Bun.sleep(0)
		expect(logged).toEqual([expect.objectContaining({ "http.route": "/stream" })])
	})

	it("never fails the request when writing the event throws", async () => {
		const { app } = probe(() => {
			throw new Error("stdout gone")
		})
		const response = await app.request("/agents/a")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ ok: true })
	})
})
