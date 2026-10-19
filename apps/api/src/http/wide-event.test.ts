import { handleError } from "@/app.ts"
import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { describe, expect, it, spyOn } from "bun:test"

import { annotate, createWideEvents, deferWideEvent, REQUEST_ID_HEADER, type WideEvent } from "./wide-event.ts"

const AGENT_ID = "11111111-1111-4111-8111-111111111111"
const SERVER_ID = "22222222-2222-4222-8222-222222222222"
const USER_ID = "33333333-3333-4333-8333-333333333333"
const ROLE_ID = "44444444-4444-4444-8444-444444444444"

function probe(write?: (event: WideEvent) => void) {
	const logged: WideEvent[] = []
	const work = Promise.withResolvers<void>()
	const app = new OpenAPIHono()
	app.use("*", createWideEvents(write ?? ((event) => logged.push(event))))
	app.get("/agents/:agentId", (c) => {
		annotate(c, { "user.id": "operator" })
		return c.json({ ok: true })
	})
	app.get("/agents/:agentId/mcp-servers/:serverId", (c) => c.body(null))
	app.get("/users/:userId", (c) => c.body(null))
	app.get("/roles/:roleId", (c) => c.body(null))
	app.post("/denied", (c) => problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN))
	app.get("/boom", () => {
		throw new TypeError("secret detail")
	})
	app.get("/stream", (c) => {
		deferWideEvent(c, work.promise)
		return c.body("streaming")
	})
	app.onError(handleError)
	return { app, logged, work }
}

describe("wide events", () => {
	it("logs one event per request with route template, identity, and generated request ID", async () => {
		const { app, logged } = probe()
		const response = await app.request(`/agents/${AGENT_ID}?email=visitor@example.com`)

		expect(response.status).toBe(200)
		expect(logged).toHaveLength(1)
		expect(logged[0]).toMatchObject({
			"http.request.method": "GET",
			"http.route": "/agents/:agentId",
			"http.response.status_code": 200,
			"agent.id": AGENT_ID,
			"user.id": "operator",
		})
		expect(Object.keys(logged[0] ?? {}).toSorted()).toEqual([
			"agent.id",
			"duration_ms",
			"http.request.method",
			"http.response.status_code",
			"http.route",
			"request.id",
			"user.id",
		])
		expect(response.headers.get(REQUEST_ID_HEADER)).toBe(logged[0]?.["request.id"] ?? null)
		expect(JSON.stringify(logged)).not.toContain("visitor@example.com")
	})

	it("records MCP server, target user, and role IDs from route parameters", async () => {
		const { app, logged } = probe()
		await app.request(`/agents/${AGENT_ID}/mcp-servers/${SERVER_ID}`)
		await app.request(`/users/${USER_ID}`)
		await app.request(`/roles/${ROLE_ID}`)

		expect(logged).toHaveLength(3)
		expect(logged[0]).toMatchObject({ "agent.id": AGENT_ID, "mcp.server.id": SERVER_ID })
		expect(logged[1]).toMatchObject({ "target.user.id": USER_ID })
		expect(logged[2]).toMatchObject({ "role.id": ROLE_ID })
	})

	it("drops route parameters that are not IDs", async () => {
		const { app, logged } = probe()
		await app.request(`/agents/${encodeURIComponent('"}{inject')}/mcp-servers/${"x".repeat(500)}`)

		expect(logged[0]).not.toHaveProperty("agent.id")
		expect(logged[0]).not.toHaveProperty("mcp.server.id")
		expect(JSON.stringify(logged)).not.toContain("inject")
	})

	it("keeps a safe inbound request ID and replaces an unsafe one", async () => {
		const { app, logged } = probe()
		await app.request("/agents/a", { headers: { [REQUEST_ID_HEADER]: "edge-123" } })
		await app.request("/agents/a", { headers: { [REQUEST_ID_HEADER]: "x".repeat(129) } })
		await app.request("/agents/a", { headers: { [REQUEST_ID_HEADER]: '"}{inject' } })

		const [kept, long, injected] = logged.map((event) => event["request.id"])
		expect(kept).toBe("edge-123")
		expect(long).not.toContain("x".repeat(129))
		expect(injected).not.toContain("inject")
	})

	it("records problem codes, error classes, and unmatched routes", async () => {
		const { app, logged } = probe()
		const consoleError = spyOn(console, "error").mockImplementation(() => undefined)
		try {
			await app.request("/denied", { method: "POST" })
			const failed = await app.request("/boom")
			await app.request("/missing")

			expect(failed.headers.get(REQUEST_ID_HEADER)).toBe(logged[1]?.["request.id"] ?? null)
		} finally {
			consoleError.mockRestore()
		}

		expect(logged).toHaveLength(3)
		expect(logged[0]).toMatchObject({
			"http.response.status_code": 403,
			"error.code": PROBLEM_CODES.PERMISSION_DENIED,
		})
		expect(logged[1]).toMatchObject({
			"http.response.status_code": 500,
			"error.code": PROBLEM_CODES.INTERNAL_SERVER_ERROR,
			"error.type": "TypeError",
		})
		expect(logged[2]).toMatchObject({ "http.route": null, "http.response.status_code": 404 })
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
		const { app, logged, work } = probe()
		const response = await app.request("/stream")

		expect(response.status).toBe(200)
		const requestId = response.headers.get(REQUEST_ID_HEADER)
		expect(requestId).toBeString()
		expect(logged).toBeEmpty()
		work.reject(new Error("generation failed"))
		await Bun.sleep(0)
		expect(logged).toHaveLength(1)
		expect(logged[0]).toMatchObject({ "http.route": "/stream", "request.id": requestId ?? "" })
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
