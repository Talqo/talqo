import { createWideEvents, type WideEvent } from "@/http/wide-event.ts"
import { describe, expect, it } from "bun:test"
import { Hono } from "hono"

import { access, isAccessPolicy, requireAccessPolicy } from "./access.ts"

type ChatEnv = { Variables: { chatCredential: string } }

function chatApp() {
	const logged: WideEvent[] = []
	const app = new Hono<ChatEnv>()
	app.use(
		"*",
		createWideEvents((event) => logged.push(event)),
	)
	app.use("*", access.chatBearer.middleware)
	app.get("/conversation", (context) => context.text(context.get("chatCredential")))
	return { app, logged }
}

describe("chat bearer access", () => {
	it.each([
		["Bearer 8f14e45f", 200],
		["bearer 8f14e45f", 401],
		["Basic 8f14e45f", 401],
		["Bearer two words", 401],
		["xBearer 8f14e45f", 401],
		["Bearer ", 401],
	])("handles the Authorization header %s", async (authorization, status) => {
		const { app } = chatApp()
		const response = await app.request("/conversation", { headers: { Authorization: authorization } })

		expect(response.status).toBe(status)
		if (status === 200) expect(await response.text()).toBe("8f14e45f")
		else expect(await response.json()).toMatchObject({ code: "chat-session-unauthorized" })
	})

	it("requires a credential when the header is absent", async () => {
		const { app } = chatApp()

		expect((await app.request("/conversation")).status).toBe(401)
	})

	it("annotates the request with the credential kind", async () => {
		const { app, logged } = chatApp()

		await app.request("/conversation", { headers: { Authorization: "Bearer 8f14e45f" } })

		expect(logged[0]).toMatchObject({ "auth.kind": "chat_bearer" })
	})
})

describe("session access", () => {
	it("rejects a request without a session cookie before touching the database", async () => {
		const logged: WideEvent[] = []
		const app = new Hono()
		app.use(
			"*",
			createWideEvents((event) => logged.push(event)),
		)
		app.use("*", access.session().middleware)
		app.get("/me", (context) => context.text("ok"))

		const response = await app.request("/me")

		expect(response.status).toBe(401)
		expect(await response.json()).toMatchObject({ code: "authentication-required" })
		expect(logged[0]).toMatchObject({ "auth.kind": "session" })
	})
})

describe("access policies", () => {
	it("recognizes only handlers declared through the access helpers", () => {
		expect(isAccessPolicy(access.public.middleware)).toBe(true)
		expect(isAccessPolicy(access.chatBearer.middleware)).toBe(true)
		expect(isAccessPolicy(() => undefined)).toBe(false)
		expect(isAccessPolicy({})).toBe(false)
	})

	it("leaves unmatched paths to the router instead of failing closed", async () => {
		const app = new Hono()
		app.use("*", requireAccessPolicy)
		app.notFound((context) => context.text("missing", 404))

		expect((await app.request("/missing")).status).toBe(404)
	})
})
