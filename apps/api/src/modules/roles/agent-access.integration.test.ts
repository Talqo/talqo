import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as agents from "@/modules/agent/agent.service.ts"
import * as conversations from "@/modules/conversation/conversation.service.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as stats from "@/modules/stats/stats.service.ts"
import { DEFAULT_PASSWORD, testAdminId, uniqueUsername } from "@/test-helpers.ts"
import { beforeEach, describe, expect, it } from "bun:test"

import * as repository from "./roles.repository.ts"
import * as roles from "./roles.service.ts"

beforeEach(async () => {
	await sql`TRUNCATE "user", agent, role CASCADE`
})

async function member() {
	return identity.createUser({ username: uniqueUsername(), password: DEFAULT_PASSWORD })
}

async function fixture() {
	const admin = await testAdminId()
	const a = await agents.createAgent({ name: "Agent A", systemPrompt: "Private A", wordBlacklist: [] })
	const b = await agents.createAgent({ name: "Agent B", systemPrompt: "Private B", wordBlacklist: [] })
	const role = await roles.createRole({ name: "Support", permissions: [] }, admin)
	const operator = await member()
	await roles.assignRoles(operator.id, [role.id], admin)
	const { token } = await identity.createSession(operator.id)
	const cookie = `${identity.SESSION_COOKIE}=${token}`
	return { admin, a, b, role, operator, cookie }
}

describe("agent-scoped access", () => {
	it("rechecks scoped authority after a queued revocation wins the management lock", async () => {
		const { admin, a, role, operator } = await fixture()
		await roles.updateRole(role.id, { name: role.name, permissions: ["roles:manage"] }, admin)
		await roles.setAgentAccess(admin, a.id, role.id, ["agents:manage"])
		const target = await roles.createRole({ name: "Queued target", permissions: [] }, admin)
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const held = repository.withAccessLock(async () => {
			entered.resolve()
			await release.promise
		})
		await entered.promise
		const revoke = roles.setAgentAccess(admin, a.id, role.id, ["agents:read"])
		const attempted = roles
			.setAgentAccess(operator.id, a.id, target.id, ["agents:manage"])
			.catch((error: unknown) => error)
		release.resolve()
		await held
		await revoke
		expect(await attempted).toMatchObject({ problemCode: "permission-exceeds-own" })
		expect(
			(await roles.listAgentAccess(admin, a.id)).roles.find((entry) => entry.id === target.id)?.permissions,
		).toEqual([])
	})
	it("keeps a role's permissions on their own agent and unions additional roles", async () => {
		const { admin, a, b, role, operator } = await fixture()
		await roles.setAgentAccess(admin, a.id, role.id, ["agents:manage"])
		await roles.setAgentAccess(admin, b.id, role.id, ["stats:read"])
		const observer = await roles.createRole({ name: "Observers", permissions: [] }, admin)
		await roles.setAgentAccess(admin, a.id, observer.id, ["conversations:read"])
		await roles.assignRoles(operator.id, [role.id, observer.id], admin)
		expect(await roles.listEffectivePermissions(operator.id)).toEqual([])
		expect(await roles.listAgentPermissions(operator.id, a.id)).toEqual([
			"conversations:read",
			"agents:read",
			"agents:manage",
		])
		expect(await roles.listAgentPermissions(operator.id, b.id)).toEqual(["stats:read"])
		expect(await roles.agentScope(operator.id, "agents:manage")).toEqual([a.id])
	})

	it("discovers names without exposing configuration and denies nested resources on another agent", async () => {
		const { admin, a, b, role, cookie, operator } = await fixture()
		await roles.setAgentAccess(admin, a.id, role.id, ["stats:read"])
		const response = await app.request("/api/agents", { headers: { Cookie: cookie } })
		expect(await response.json()).toMatchObject({ agents: [{ id: a.id, permissions: ["stats:read"] }] })
		const discovery = await agents.listVisibleAgents(operator.id)
		expect(discovery[0]).not.toHaveProperty("systemPrompt")
		const get = (path: string) => app.request(`/api${path}`, { headers: { Cookie: cookie } })
		expect((await get(`/agents/${a.id}`)).status).toBe(403)
		expect((await get(`/agents/${b.id}`)).status).toBe(404)
		expect((await get(`/agents/${b.id}/files`)).status).toBe(404)
		expect((await get(`/agents/${b.id}/mcp-servers`)).status).toBe(404)
	})

	it("does not give an existing role access to a newly created agent", async () => {
		const { admin, a, role, operator, cookie } = await fixture()
		await roles.setAgentAccess(admin, a.id, role.id, ["agents:manage"])
		const created = await agents.createAgent({ name: "New agent", systemPrompt: "Private", wordBlacklist: [] })
		expect(await roles.listAgentPermissions(operator.id, created.id)).toEqual([])
		const response = await app.request("/api/agents", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Forbidden", systemPrompt: "No", wordBlacklist: [] }),
		})
		expect(response.status).toBe(403)
	})

	it("bounds grant additions, removals and implication changes by the caller's authority", async () => {
		const { admin, a, b, role, operator } = await fixture()
		await roles.updateRole(role.id, { name: role.name, permissions: ["roles:manage"] }, admin)
		await roles.setAgentAccess(admin, a.id, role.id, ["agents:read"])
		const target = await roles.createRole({ name: "Target", permissions: [] }, admin)
		await roles.setAgentAccess(operator.id, a.id, target.id, ["agents:read"])
		await expect(roles.setAgentAccess(operator.id, a.id, target.id, ["agents:manage"])).rejects.toMatchObject({
			problemCode: "permission-exceeds-own",
		})
		await roles.setAgentAccess(admin, a.id, target.id, ["agents:manage"])
		await expect(roles.setAgentAccess(operator.id, a.id, target.id, ["agents:read"])).rejects.toMatchObject({
			problemCode: "permission-exceeds-own",
		})
		await expect(roles.setAgentAccess(operator.id, a.id, target.id, [])).rejects.toMatchObject({
			problemCode: "permission-exceeds-own",
		})
		await expect(roles.setAgentAccess(operator.id, b.id, target.id, ["agents:read"])).rejects.toMatchObject({
			status: 404,
		})
	})

	it("prevents escalation through membership, role deletion, password reset and operator deletion", async () => {
		const { admin, a, b, role, operator } = await fixture()
		await roles.updateRole(role.id, { name: role.name, permissions: ["roles:manage", "users:manage"] }, admin)
		await roles.setAgentAccess(admin, a.id, role.id, ["agents:manage"])
		const powerful = await roles.createRole({ name: "Other agent editors", permissions: [] }, admin)
		await roles.setAgentAccess(admin, b.id, powerful.id, ["agents:manage"])
		const target = await member()
		await roles.assignRoles(target.id, [powerful.id], admin)
		await expect(roles.assignRoles(operator.id, [role.id, powerful.id], operator.id)).rejects.toMatchObject({
			problemCode: "permission-exceeds-own",
		})
		await expect(roles.assignRoles(target.id, [], operator.id)).rejects.toMatchObject({
			problemCode: "permission-exceeds-own",
		})
		await expect(roles.deleteRole(powerful.id, operator.id)).rejects.toMatchObject({
			problemCode: "permission-exceeds-own",
		})
		await expect(roles.resetUserPassword(target.id, "new-password-long-enough", operator.id)).rejects.toMatchObject({
			problemCode: "permission-exceeds-own",
		})
		await expect(roles.deleteUser(target.id, operator.id)).rejects.toMatchObject({
			problemCode: "permission-exceeds-own",
		})
		expect((await roles.listUsersWithAccess(operator.id)).find((user) => user.id === target.id)?.canManage).toBe(false)
	})

	it("revokes the next request without ending the session and cascades removed agents", async () => {
		const { admin, a, role, operator, cookie } = await fixture()
		await roles.setAgentAccess(admin, a.id, role.id, ["agents:read"])
		const get = () => app.request(`/api/agents/${a.id}`, { headers: { Cookie: cookie } })
		expect((await get()).status).toBe(200)
		await roles.setAgentAccess(admin, a.id, role.id, [])
		expect((await get()).status).toBe(404)
		await roles.setAgentAccess(admin, a.id, role.id, ["agents:read"])
		await agents.deleteAgent(a.id)
		expect(await roles.listAgentPermissions(operator.id, a.id)).toEqual([])
	})

	it("filters analytics and conversations independently, including totals and explicit filters", async () => {
		const { admin, a, b, role, operator } = await fixture()
		await roles.setAgentAccess(admin, a.id, role.id, ["stats:read", "conversations:read"])
		await sql`INSERT INTO conversation (id, agent_id, embed_access_version) VALUES (${crypto.randomUUID()}, ${a.id}, 1), (${crypto.randomUUID()}, ${b.id}, 1)`
		const page = await conversations.listConversations({ page: 1 }, operator.id)
		expect(page.total).toBe(1)
		expect(page.conversations.map((conversation) => conversation.agentId)).toEqual([a.id])
		expect((await conversations.listConversations({ page: 1, agentId: [b.id] }, operator.id)).total).toBe(0)
		const all = await conversations.listConversations({ page: 1 }, admin)
		const hidden = all.conversations.find((conversation) => conversation.agentId === b.id)
		if (!hidden) throw new Error("Missing hidden conversation")
		await expect(conversations.getConversationTranscript(hidden.id, operator.id)).rejects.toMatchObject({ status: 404 })
		const overview = await stats.getStatsOverview({ days: 1 }, operator.id)
		expect(overview.totals.conversations).toBe(1)
		expect(overview.agents.map((agent) => agent.agentId)).toEqual([a.id])
		await roles.setAgentAccess(admin, a.id, role.id, ["agents:manage"])
		await expect(stats.getStatsOverview({ days: 1 }, operator.id)).rejects.toMatchObject({ status: 403 })
		await expect(conversations.listConversations({ page: 1 }, operator.id)).rejects.toMatchObject({ status: 403 })
	})
})
