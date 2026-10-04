import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as agentService from "@/modules/agent/agent.service.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { beforeEach, describe, expect, it } from "bun:test"

import { getStatsOverview } from "./conversation.service.ts"

const MILLISECONDS_PER_DAY = 86_400_000
const OUTSIDE_WINDOW_DAYS = 40

function utcDate(daysAgo: number): string {
	return new Date(Date.now() - daysAgo * MILLISECONDS_PER_DAY).toISOString()
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

async function seedChatHistory(agentA: string, agentB: string): Promise<void> {
	const attempts = [
		{
			id: crypto.randomUUID(),
			attemptId: crypto.randomUUID(),
			agentId: agentA,
			createdAt: utcDate(0),
			inputTokens: 100,
			outputTokens: 50,
		},
		{
			id: crypto.randomUUID(),
			attemptId: crypto.randomUUID(),
			agentId: agentA,
			createdAt: utcDate(0),
			inputTokens: 200,
			outputTokens: 100,
		},
		{
			id: crypto.randomUUID(),
			attemptId: crypto.randomUUID(),
			agentId: agentA,
			createdAt: utcDate(2),
			inputTokens: 10,
			outputTokens: 5,
		},
		{
			id: crypto.randomUUID(),
			attemptId: crypto.randomUUID(),
			agentId: agentA,
			createdAt: utcDate(OUTSIDE_WINDOW_DAYS),
			inputTokens: 1000,
			outputTokens: 500,
		},
		{
			id: crypto.randomUUID(),
			attemptId: crypto.randomUUID(),
			agentId: agentB,
			createdAt: utcDate(0),
			inputTokens: 1,
			outputTokens: 2,
		},
	]
	await Promise.all(
		attempts.map(
			(row) => sql`
				INSERT INTO conversation (id, agent_id, embed_access_version, created_at)
				VALUES (${row.id}, ${row.agentId}, 1, ${row.createdAt})
			`,
		),
	)
	await Promise.all(
		attempts.map(
			(row) => sql`
				INSERT INTO generation_attempt
					(id, conversation_id, request_id, estimated_input_tokens, network_hash, lease_token, lease_expires_at, created_at)
				VALUES
					(${row.attemptId}, ${row.id}, ${crypto.randomUUID()}, 1, 'network', ${crypto.randomUUID()},
						${row.createdAt}, ${row.createdAt})
			`,
		),
	)
	await Promise.all(
		attempts.map(
			(row) => sql`
				INSERT INTO message (id, conversation_id, generation_attempt_id, role, text, outcome, created_at)
				VALUES
					(${crypto.randomUUID()}, ${row.id}, ${row.attemptId}, 'user', 'question', 'completed', ${row.createdAt}),
					(${crypto.randomUUID()}, ${row.id}, ${row.attemptId}, 'assistant', 'answer', 'completed', ${row.createdAt})
			`,
		),
	)
	await Promise.all(
		attempts.map(
			(row) => sql`
				INSERT INTO usage_record
					(generation_attempt_id, agent_id, conversation_id, provider, model, outcome, input_tokens, output_tokens, created_at)
				VALUES
					(${row.attemptId}, ${row.agentId}, ${row.id}, 'fake', 'chat-model', 'completed',
						${row.inputTokens}, ${row.outputTokens}, ${row.createdAt})
			`,
		),
	)
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE
		usage_record, message, generation_attempt, conversation_daily_counter, conversation,
		embed, blacklist_word, agent, permission_grant, invitation, session, "user" CASCADE`
})

describe("stats overview aggregation", () => {
	it("aggregates daily counts, token sums, and per-agent totals within the window", async () => {
		const agentA = await agentService.createAgent({ name: "Alpha", systemPrompt: "A.", wordBlacklist: [] })
		const agentB = await agentService.createAgent({ name: "Beta", systemPrompt: "B.", wordBlacklist: [] })
		await seedChatHistory(agentA.id, agentB.id)

		const overview = await getStatsOverview({ days: 30 })

		expect(overview.days).toBe(30)
		expect(overview.daily).toHaveLength(30)
		const byDate = new Map(overview.daily.map((day) => [day.date, day]))
		expect(byDate.get(utcDate(0).slice(0, 10))).toEqual({
			date: utcDate(0).slice(0, 10),
			conversations: 3,
			messages: 6,
			inputTokens: 301,
			outputTokens: 152,
		})
		expect(byDate.get(utcDate(2).slice(0, 10))).toEqual({
			date: utcDate(2).slice(0, 10),
			conversations: 1,
			messages: 2,
			inputTokens: 10,
			outputTokens: 5,
		})
		// Days without activity are zero-filled so the chart series is dense.
		expect(byDate.get(utcDate(5).slice(0, 10))).toEqual({
			date: utcDate(5).slice(0, 10),
			conversations: 0,
			messages: 0,
			inputTokens: 0,
			outputTokens: 0,
		})
		expect(overview.totals).toEqual({ conversations: 4, messages: 8, inputTokens: 311, outputTokens: 157 })
		// Active conversations count any conversation with a recent message; the 2-day and
		// 40-day-old conversations stay outside the window.
		expect(overview.activeWindowMinutes).toBe(60)
		expect(overview.active).toHaveLength(2)
		expect(overview.active).toContainEqual({ agentId: agentA.id, conversations: 2 })
		expect(overview.active).toContainEqual({ agentId: agentB.id, conversations: 1 })
		// The sparse per-agent daily series feeds the dashboard per-agent chart lines.
		const byAgentDate = new Map(overview.agentDaily.map((point) => [`${point.agentId}:${point.date}`, point]))
		expect(byAgentDate.get(`${agentA.id}:${utcDate(0).slice(0, 10)}`)).toEqual({
			agentId: agentA.id,
			date: utcDate(0).slice(0, 10),
			conversations: 2,
			messages: 4,
			inputTokens: 300,
			outputTokens: 150,
		})
		expect(byAgentDate.get(`${agentA.id}:${utcDate(2).slice(0, 10)}`)).toEqual({
			agentId: agentA.id,
			date: utcDate(2).slice(0, 10),
			conversations: 1,
			messages: 2,
			inputTokens: 10,
			outputTokens: 5,
		})
		expect(byAgentDate.get(`${agentB.id}:${utcDate(0).slice(0, 10)}`)).toEqual({
			agentId: agentB.id,
			date: utcDate(0).slice(0, 10),
			conversations: 1,
			messages: 2,
			inputTokens: 1,
			outputTokens: 2,
		})
		// Days without activity have no per-agent row; the consumer zero-fills the axis.
		expect(byAgentDate.has(`${agentA.id}:${utcDate(5).slice(0, 10)}`)).toBe(false)
		expect(overview.agents).toEqual([
			{
				agentId: agentA.id,
				agentName: "Alpha",
				conversations: 3,
				messages: 6,
				inputTokens: 310,
				outputTokens: 155,
			},
			{
				agentId: agentB.id,
				agentName: "Beta",
				conversations: 1,
				messages: 2,
				inputTokens: 1,
				outputTokens: 2,
			},
		])
	})

	it("filters the daily series and totals by agent", async () => {
		const agentA = await agentService.createAgent({ name: "Alpha", systemPrompt: "A.", wordBlacklist: [] })
		const agentB = await agentService.createAgent({ name: "Beta", systemPrompt: "B.", wordBlacklist: [] })
		await seedChatHistory(agentA.id, agentB.id)

		const overview = await getStatsOverview({ days: 30, agentId: agentB.id })

		expect(overview.totals).toEqual({ conversations: 1, messages: 2, inputTokens: 1, outputTokens: 2 })
		const today = overview.daily.find((day) => day.date === utcDate(0).slice(0, 10))
		expect(today).toMatchObject({ conversations: 1, messages: 2, inputTokens: 1, outputTokens: 2 })
		expect(overview.daily.reduce((sum, day) => sum + day.conversations, 0)).toBe(1)
		// The per-agent breakdown stays global; the filter scopes totals and the daily series.
		expect(overview.agents).toHaveLength(2)
		// The per-agent daily series stays global as well so callers can re-aggregate client-side.
		expect(new Set(overview.agentDaily.map((point) => point.agentId)).size).toBe(2)
	})

	it("respects the requested day window", async () => {
		const agentA = await agentService.createAgent({ name: "Alpha", systemPrompt: "A.", wordBlacklist: [] })
		const agentB = await agentService.createAgent({ name: "Beta", systemPrompt: "B.", wordBlacklist: [] })
		await seedChatHistory(agentA.id, agentB.id)

		const overview = await getStatsOverview({ days: 1 })

		expect(overview.daily).toHaveLength(1)
		expect(overview.totals).toEqual({ conversations: 3, messages: 6, inputTokens: 301, outputTokens: 152 })
	})

	it("rejects members without agents:read and serves admins", async () => {
		const { cookie: adminCookie, userId } = await createAdminSession()
		const memberUsername = uniqueUsername()
		const member = await identity.createAccount({ username: memberUsername, password: DEFAULT_PASSWORD })
		const memberCookie = await login(memberUsername)

		const forbidden = await app.request("/api/stats/overview", { headers: { Cookie: memberCookie } })
		expect(forbidden.status).toBe(403)
		expect(await forbidden.json()).toMatchObject({ code: "permission-denied" })

		const allowed = await app.request("/api/stats/overview?days=7", { headers: { Cookie: adminCookie } })
		expect(allowed.status).toBe(200)
		const body = (await allowed.json()) as { overview: { days: number; daily: unknown[] } }
		expect(body.overview.days).toBe(7)
		expect(body.overview.daily).toHaveLength(7)

		// A member granted agents:read passes the gate.
		await roles.grantPermission({ userId: member.id, permission: "agents:read", grantedBy: userId })
		const granted = await app.request("/api/stats/overview", { headers: { Cookie: memberCookie } })
		expect(granted.status).toBe(200)
	})
})
