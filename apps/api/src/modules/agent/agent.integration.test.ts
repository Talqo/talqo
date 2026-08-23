import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { beforeEach, describe, expect, it } from "bun:test"

import * as service from "./agent.service.ts"

type AgentPayload = {
	agent: {
		createdAt: string
		embedToken: string
		id: string
		name: string
		systemPrompt: string
		updatedAt: string
		wordBlacklist: string[]
	}
}

async function login(username: string): Promise<string> {
	const response = await app.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password: DEFAULT_PASSWORD }),
	})
	const setCookie = response.headers.get("set-cookie")
	if (!setCookie) throw new Error("Expected a Set-Cookie header")
	const [cookiePair] = setCookie.split(";")
	if (!cookiePair) throw new Error("Malformed Set-Cookie header")
	return cookiePair
}

async function createAdminSession(): Promise<{ cookie: string; userId: string }> {
	const username = uniqueUsername()
	const admin = await roles.bootstrapAdmin({ username, password: DEFAULT_PASSWORD })
	return { cookie: await login(username), userId: admin.id }
}

async function createMemberSession(
	grantedBy: string,
	permissions: ("agents:read" | "agents:manage")[] = [],
): Promise<string> {
	const username = uniqueUsername()
	const member = await identity.createAccount({ username, password: DEFAULT_PASSWORD })
	await Promise.all(
		permissions.map((permission) => roles.grantPermission({ userId: member.id, permission, grantedBy })),
	)
	return login(username)
}

function createJsonRequest(cookie: string, method: string, path: string, body?: unknown): Response | Promise<Response> {
	return app.request(path, {
		method,
		headers: { Cookie: cookie, "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE blacklist_word, agent, permission_grant, invitation, user_role, session, "user"`
})

describe("agent CRUD", () => {
	it("creates, reads, updates, and hard-deletes an aggregate", async () => {
		const { cookie } = await createAdminSession()

		const created = await createJsonRequest(cookie, "POST", "/api/agents", {
			name: "Support",
			systemPrompt: "Help users.",
			wordBlacklist: ["Spam", "SPAM", "abuse"],
		})
		expect(created.status).toBe(201)
		const { agent } = (await created.json()) as AgentPayload
		expect(agent.name).toBe("Support")
		expect(agent.wordBlacklist).toEqual(["Spam", "abuse"])

		const fetched = await app.request(`/api/agents/${agent.id}`, { headers: { Cookie: cookie } })
		expect(fetched.status).toBe(200)
		const fetchedBody = (await fetched.json()) as AgentPayload
		expect(fetchedBody.agent.id).toBe(agent.id)
		expect(fetchedBody.agent.wordBlacklist).toEqual(["Spam", "abuse"])

		const updated = await createJsonRequest(cookie, "PUT", `/api/agents/${agent.id}`, {
			name: "Support 2",
			systemPrompt: "Help more.",
			wordBlacklist: ["abuse"],
		})
		expect(updated.status).toBe(200)
		expect(((await updated.json()) as AgentPayload).agent.systemPrompt).toBe("Help more.")

		const listed = await app.request("/api/agents", { headers: { Cookie: cookie } })
		const { agents } = (await listed.json()) as { agents: { name: string }[] }
		expect(agents.map((row) => row.name)).toEqual(["Support 2"])

		const deleted = await app.request(`/api/agents/${agent.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		})
		expect(deleted.status).toBe(204)

		const refetch = await app.request(`/api/agents/${agent.id}`, { headers: { Cookie: cookie } })
		expect(refetch.status).toBe(404)
	})

	it("cascades blacklist rows on delete", async () => {
		const { cookie } = await createAdminSession()
		const created = await createJsonRequest(cookie, "POST", "/api/agents", {
			name: "Cascade",
			systemPrompt: "Prompt",
			wordBlacklist: ["one", "two"],
		})
		const { agent } = (await created.json()) as AgentPayload

		const before = await sql`SELECT count(*)::int AS count FROM blacklist_word WHERE agent_id = ${agent.id}`
		expect(before[0]?.count).toBe(2)

		await app.request(`/api/agents/${agent.id}`, { method: "DELETE", headers: { Cookie: cookie } })

		const after = await sql`SELECT count(*)::int AS count FROM blacklist_word WHERE agent_id = ${agent.id}`
		expect(after[0]?.count).toBe(0)
	})

	it("orders the list case-insensitively by name", async () => {
		const { cookie } = await createAdminSession()
		await createJsonRequest(cookie, "POST", "/api/agents", {
			name: "zebra",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})
		await createJsonRequest(cookie, "POST", "/api/agents", {
			name: "Apple",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})

		const response = await app.request("/api/agents", { headers: { Cookie: cookie } })
		const { agents } = (await response.json()) as { agents: { name: string }[] }
		expect(agents.map((row) => row.name)).toEqual(["Apple", "zebra"])
	})

	it("rejects duplicate agent names case-insensitively on create and persists nothing", async () => {
		const { cookie } = await createAdminSession()
		await createJsonRequest(cookie, "POST", "/api/agents", {
			name: "Support",
			systemPrompt: "Prompt",
			wordBlacklist: ["spam"],
		})

		const duplicate = await createJsonRequest(cookie, "POST", "/api/agents", {
			name: " support ",
			systemPrompt: "Prompt",
			wordBlacklist: ["word-that-must-not-persist"],
		})
		expect(duplicate.status).toBe(409)

		const agentCount = await sql`SELECT count(*)::int AS count FROM agent`
		expect(agentCount[0]?.count).toBe(1)
		const wordCount = await sql`SELECT count(*)::int AS count FROM blacklist_word`
		expect(wordCount[0]?.count).toBe(1)

		const listed = await app.request("/api/agents", { headers: { Cookie: cookie } })
		const { agents: listedAgents } = (await listed.json()) as { agents: { name: string }[] }
		expect(listedAgents.map((row) => row.name)).toEqual(["Support"])
	})

	it("rejects duplicate names case-insensitively on update", async () => {
		const { cookie } = await createAdminSession()
		await createJsonRequest(cookie, "POST", "/api/agents", {
			name: "Alpha",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})
		const second = await createJsonRequest(cookie, "POST", "/api/agents", {
			name: "Beta",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})
		const { agent } = (await second.json()) as AgentPayload

		const conflict = await createJsonRequest(cookie, "PUT", `/api/agents/${agent.id}`, {
			name: " ALPHA",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})
		expect(conflict.status).toBe(409)
	})

	it("returns 404 when updating or deleting an unknown agent", async () => {
		const { cookie } = await createAdminSession()
		const unknown = crypto.randomUUID()

		const updated = await createJsonRequest(cookie, "PUT", `/api/agents/${unknown}`, {
			name: "Ghost",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})
		expect(updated.status).toBe(404)

		const deleted = await app.request(`/api/agents/${unknown}`, { method: "DELETE", headers: { Cookie: cookie } })
		expect(deleted.status).toBe(404)
	})

	it("rejects invalid aggregate payloads with 400", async () => {
		const { cookie } = await createAdminSession()

		const emptyName = await createJsonRequest(cookie, "POST", "/api/agents", {
			name: "",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})
		expect(emptyName.status).toBe(400)

		const tooManyWords = await createJsonRequest(cookie, "POST", "/api/agents", {
			name: "Too many",
			systemPrompt: "Prompt",
			wordBlacklist: Array.from({ length: 101 }, (_, index) => `word${index}`),
		})
		expect(tooManyWords.status).toBe(400)
	})

	it("rotates the embed token, leaving the old one orphaned", async () => {
		const { cookie, userId } = await createAdminSession()
		const created = await createJsonRequest(cookie, "POST", "/api/agents", {
			name: "Token Carrier",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})
		expect(created.status).toBe(201)
		const { agent } = (await created.json()) as AgentPayload
		expect(agent.embedToken).toMatch(/^[0-9a-f-]{36}$/)

		const reader = await createMemberSession(userId, ["agents:read"])
		const forbidden = await app.request(`/api/agents/${agent.id}/embed-token/refresh`, {
			method: "POST",
			headers: { Cookie: reader },
		})
		expect(forbidden.status).toBe(403)

		const rotated = await app.request(`/api/agents/${agent.id}/embed-token/refresh`, {
			method: "POST",
			headers: { Cookie: cookie },
		})
		expect(rotated.status).toBe(200)
		const rotatedAgent = ((await rotated.json()) as AgentPayload).agent
		expect(rotatedAgent.embedToken).toMatch(/^[0-9a-f-]{36}$/)
		expect(rotatedAgent.embedToken).not.toBe(agent.embedToken)

		const fetched = await app.request(`/api/agents/${agent.id}`, { headers: { Cookie: cookie } })
		expect(((await fetched.json()) as AgentPayload).agent.embedToken).toBe(rotatedAgent.embedToken)

		const missing = await app.request(`/api/agents/${crypto.randomUUID()}/embed-token/refresh`, {
			method: "POST",
			headers: { Cookie: cookie },
		})
		expect(missing.status).toBe(404)
	})
})

describe("agent service interface", () => {
	it("exposes normalized aggregates to in-process consumers", async () => {
		const created = await service.createAgent({
			name: "  Direct Consumer  ",
			systemPrompt: "  Serve via service.  ",
			wordBlacklist: ["Spam", "spam "],
		})

		expect(created.name).toBe("Direct Consumer")
		expect(created.wordBlacklist).toEqual(["Spam"])

		const fetched = await service.getAgent(created.id)
		expect(fetched).toEqual(created)

		const listed = await service.listAgents()
		expect(listed.map((agent) => agent.id)).toEqual([created.id])

		await service.deleteAgent(created.id)
		await expect(service.getAgent(created.id)).rejects.toBeInstanceOf(service.AgentNotFoundError)
	})

	it("refreshes the embed token and reports a missing aggregate", async () => {
		const created = await service.createAgent({
			name: "Token Service",
			systemPrompt: "Serve via service.",
			wordBlacklist: [],
		})

		const refreshed = await service.refreshEmbedToken(created.id)
		expect(refreshed.embedToken).not.toBe(created.embedToken)
		expect((await service.getAgent(created.id)).embedToken).toBe(refreshed.embedToken)
		expect(refreshed.updatedAt).toEqual(created.updatedAt)

		await expect(service.refreshEmbedToken(crypto.randomUUID())).rejects.toBeInstanceOf(service.AgentNotFoundError)
	})
})

describe("agent authorization", () => {
	it("lets a read-only operator list and inspect but not mutate", async () => {
		const admin = await createAdminSession()
		const created = await createJsonRequest(admin.cookie, "POST", "/api/agents", {
			name: "ReadOnly Target",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})
		const { agent } = (await created.json()) as AgentPayload

		const reader = await createMemberSession(admin.userId, ["agents:read"])
		expect((await app.request("/api/agents", { headers: { Cookie: reader } })).status).toBe(200)
		expect((await app.request(`/api/agents/${agent.id}`, { headers: { Cookie: reader } })).status).toBe(200)

		const attemptCreate = await createJsonRequest(reader, "POST", "/api/agents", {
			name: "Nope",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})
		expect(attemptCreate.status).toBe(403)

		const attemptUpdate = await createJsonRequest(reader, "PUT", `/api/agents/${agent.id}`, {
			name: "Nope",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})
		expect(attemptUpdate.status).toBe(403)

		expect(
			(await app.request(`/api/agents/${agent.id}`, { method: "DELETE", headers: { Cookie: reader } })).status,
		).toBe(403)
	})

	it("lets a manage-only operator read, because manage implies read", async () => {
		const admin = await createAdminSession()
		const manager = await createMemberSession(admin.userId, ["agents:manage"])
		const created = await createJsonRequest(manager, "POST", "/api/agents", {
			name: "Managed",
			systemPrompt: "Prompt",
			wordBlacklist: [],
		})
		expect(created.status).toBe(201)
		expect((await app.request("/api/agents", { headers: { Cookie: manager } })).status).toBe(200)
	})

	it("denies all agent endpoints to an operator without agent grants", async () => {
		const admin = await createAdminSession()
		const member = await createMemberSession(admin.userId)
		expect((await app.request("/api/agents", { headers: { Cookie: member } })).status).toBe(403)
		expect(
			(
				await createJsonRequest(member, "POST", "/api/agents", {
					name: "X",
					systemPrompt: "P",
					wordBlacklist: [],
				})
			).status,
		).toBe(403)
	})

	it("denies the next request after a grant is revoked, using the same session", async () => {
		const admin = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		const grant = await roles.grantPermission({
			userId: member.id,
			permission: "agents:read",
			grantedBy: admin.userId,
		})
		const memberCookie = await login(memberUsername)

		expect((await app.request("/api/agents", { headers: { Cookie: memberCookie } })).status).toBe(200)

		await roles.revokePermission(grant.id)
		expect((await app.request("/api/agents", { headers: { Cookie: memberCookie } })).status).toBe(403)
	})
})
