import { sql } from "@/db/client.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi"
import { beforeEach, describe, expect, it } from "bun:test"

import { access, isAccessPolicy } from "./access.ts"
import { PROBLEM_CODES } from "./problem.ts"
import { HTTP_STATUS } from "./status.ts"

const targetBodySchema = z.object({ permissions: z.array(z.enum(roles.PERMISSIONS)) })

type ResolverCall = { body?: unknown; params: Record<string, string> }
let resolverCalls: ResolverCall[] = []

const targetedPermissionsRoute = createRoute({
	method: "put",
	path: "/things/{thingId}",
	...access.permission(roles.Permission.AgentsRead, {
		target: {
			body: targetBodySchema,
			resolve: async (request) => {
				resolverCalls.push(request)
				return request.body.permissions
			},
		},
	}),
	request: {
		params: z.object({ thingId: z.string() }),
		body: { content: { "application/json": { schema: targetBodySchema } }, required: true },
	},
	responses: { 200: { description: "Reached" } },
})

const uploadRoute = createRoute({
	method: "post",
	path: "/things/{thingId}/upload",
	...access.permission(roles.Permission.AgentsRead, {
		target: {
			resolve: async (request) => {
				resolverCalls.push(request)
				return [roles.Permission.AgentsRead]
			},
		},
	}),
	request: { params: z.object({ thingId: z.string() }) },
	responses: { 200: { description: "Reached" } },
})

const probe = new OpenAPIHono()
	.openapi(targetedPermissionsRoute, (c) => c.json({ reached: true }, HTTP_STATUS.OK))
	.openapi(uploadRoute, async (c) => {
		const file = (await c.req.formData()).get("file")
		return c.json({ fileName: file instanceof File ? file.name : null }, HTTP_STATUS.OK)
	})

async function sessionCookie(permissions: roles.Permission[]): Promise<string> {
	const user = await identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })
	await Promise.all(
		permissions.map((permission) => roles.grantPermission({ userId: user.id, permission, grantedBy: user.id })),
	)
	const { token } = await identity.createSession(user.id)
	return `${identity.SESSION_COOKIE}=${token}`
}

async function adminCookie(): Promise<string> {
	const username = uniqueUsername()
	const admin = await roles.bootstrapAdmin({ username, password: DEFAULT_PASSWORD })
	const { token } = await identity.createSession(admin.id)
	return `${identity.SESSION_COOKIE}=${token}`
}

function putThing(cookie: string | undefined, body: string) {
	return probe.request("/things/t1", {
		method: "PUT",
		headers: { ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" },
		body,
	})
}

function requestPermissions(cookie: string | undefined, permissions: roles.Permission[]) {
	return putThing(cookie, JSON.stringify({ permissions }))
}

async function expectProblem(response: Response, status: number, code: string) {
	expect(response.status).toBe(status)
	expect(await response.json()).toEqual({ code, type: `https://docs.talqo.chat/problems#${code}` })
}

beforeEach(async () => {
	resolverCalls = []
	await sql`TRUNCATE TABLE permission_grant, session, "user" CASCADE`
})

describe("access.permission with a target", () => {
	it("allows a caller who holds every targeted permission and passes params and the parsed body", async () => {
		const cookie = await sessionCookie([roles.Permission.AgentsRead, roles.Permission.AiProviderManage])

		const response = await requestPermissions(cookie, [roles.Permission.AiProviderManage])

		expect(response.status).toBe(200)
		expect(resolverCalls).toEqual([
			{ params: { thingId: "t1" }, body: { permissions: [roles.Permission.AiProviderManage] } },
		])
	})

	it("counts implied permissions as held", async () => {
		const cookie = await sessionCookie([roles.Permission.AgentsManage])

		const response = await requestPermissions(cookie, [roles.Permission.AgentsRead])

		expect(response.status).toBe(200)
	})

	it("refuses a target beyond the caller's own permissions", async () => {
		const cookie = await sessionCookie([roles.Permission.AgentsRead])

		const response = await requestPermissions(cookie, [roles.Permission.AgentsManage])

		await expectProblem(response, 403, PROBLEM_CODES.PERMISSION_EXCEEDS_OWN)
	})

	it("lets the admin target every permission", async () => {
		const cookie = await adminCookie()

		const response = await requestPermissions(cookie, [...roles.PERMISSIONS])

		expect(response.status).toBe(200)
	})

	it("checks the gate permission before resolving the target", async () => {
		const cookie = await sessionCookie([roles.Permission.AiProviderManage])

		const response = await requestPermissions(cookie, [])

		await expectProblem(response, 403, PROBLEM_CODES.PERMISSION_DENIED)
		expect(resolverCalls).toEqual([])
	})

	it("resolves nothing for an unauthenticated request", async () => {
		const response = await requestPermissions(undefined, [])

		await expectProblem(response, 401, PROBLEM_CODES.AUTHENTICATION_REQUIRED)
		expect(resolverCalls).toEqual([])
	})

	it("answers 400 for a body that fails the target schema instead of skipping the check", async () => {
		const cookie = await sessionCookie([roles.Permission.AgentsRead])

		const response = await putThing(cookie, JSON.stringify({ permissions: ["not-a-permission"] }))

		await expectProblem(response, 400, PROBLEM_CODES.INVALID_REQUEST)
		expect(resolverCalls).toEqual([])
	})

	it("never reads the body of a route that declares no target body", async () => {
		const cookie = await sessionCookie([roles.Permission.AgentsRead])
		const form = new FormData()
		form.append("file", new File(["hello"], "notes.md", { type: "text/markdown" }))

		const response = await probe.request("/things/t1/upload", {
			method: "POST",
			headers: { Cookie: cookie },
			body: form,
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ fileName: "notes.md" })
		expect(resolverCalls).toEqual([{ params: { thingId: "t1" } }])
	})

	it("stays a registered access policy", () => {
		const { middleware } = access.permission(roles.Permission.AgentsRead, { target: { resolve: async () => [] } })

		expect(isAccessPolicy(middleware)).toBe(true)
	})
})
