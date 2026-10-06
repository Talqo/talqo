import { app } from "@/app.ts"
import { db, sql } from "@/db/client.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { beforeEach, describe, expect, it } from "bun:test"
import { eq } from "drizzle-orm"

import { mcpServer } from "./mcp.schema.ts"
import * as service from "./mcp.service.ts"

const UNREACHABLE_URL = "http://127.0.0.1:1/mcp"

/** Asserts the row was refused by a named check constraint, so a foreign key cannot pass for one. */
async function expectCheckViolation(insert: Promise<unknown>): Promise<void> {
	const error = await insert.then(
		() => null,
		(caught: unknown) => caught,
	)
	if (!error) throw new Error("expected the insert to be refused")
	const text = [String(error), String((error as { cause?: unknown }).cause ?? "")].join(" ")
	expect(text).toMatch(/mcp_server_\w+_check/)
}

async function createAgent(name = `Shop assistant ${crypto.randomUUID().slice(0, 8)}`): Promise<string> {
	return (await agent.createAgent({ name, systemPrompt: "You help shoppers.", wordBlacklist: [] })).id
}

async function managerUserId(): Promise<string> {
	const account = await identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })
	await roles.grantPermission({
		userId: account.id,
		permission: roles.Permission.AgentsManage,
		grantedBy: account.id,
	})
	return account.id
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE mcp_server CASCADE`
	await sql`TRUNCATE TABLE blacklist_word, agent CASCADE`
})

describe("mcp schema constraints", () => {
	// A stdio row's null auth_mode makes `auth_mode = 'headers'` evaluate to null rather than false,
	// and a check whose result is null passes. These are the rows that would slip through otherwise.
	/** Structure only: these rows never decrypt, they only have to satisfy the jsonb column. */
	const secret = { ciphertext: "c", nonce: "n", tag: "t", version: 1 as const }
	type McpInsert = typeof mcpServer.$inferInsert
	type Columns = Partial<McpInsert>

	// A stdio row's null authMode makes `authMode = 'headers'` evaluate to null rather than false,
	// and a check whose result is null passes. These are the rows that would slip through otherwise.
	const rejected: [string, Columns][] = [
		["http carrying a command", { transport: "http", url: UNREACHABLE_URL, authMode: "none", command: "npx" }],
		["http with no address", { transport: "http", authMode: "none" }],
		["http carrying arguments", { transport: "http", url: UNREACHABLE_URL, authMode: "none", args: ["x"] }],
		["stdio with an auth mode", { transport: "stdio", command: "npx", authMode: "none" }],
		["stdio with headers", { transport: "stdio", command: "npx", headers: { a: secret } }],
		["stdio with oauth tokens", { transport: "stdio", command: "npx", oauthTokens: secret }],
		["stdio with no command", { transport: "stdio" }],
		["none carrying headers", { transport: "http", url: UNREACHABLE_URL, authMode: "none", headers: { a: secret } }],
		["none carrying oauth tokens", { transport: "http", url: UNREACHABLE_URL, authMode: "none", oauthTokens: secret }],
		["headers with no headers", { transport: "http", url: UNREACHABLE_URL, authMode: "headers" }],
		[
			"headers carrying oauth tokens",
			{ transport: "http", url: UNREACHABLE_URL, authMode: "headers", headers: { a: secret }, oauthTokens: secret },
		],
		["oauth carrying headers", { transport: "http", url: UNREACHABLE_URL, authMode: "oauth", headers: { a: secret } }],
		[
			"oauth pending without an expiry",
			{ transport: "http", url: UNREACHABLE_URL, authMode: "oauth", oauthPending: secret },
		],
	]

	for (const [label, columns] of rejected) {
		it(`rejects ${label}`, async () => {
			const agentId = await createAgent()
			await expectCheckViolation(
				db.insert(mcpServer).values({ id: "probe", agentId, name: "probe", ...columns } as McpInsert),
			)
		})
	}

	const accepted: [string, Columns][] = [
		["http with no headers", { transport: "http", url: UNREACHABLE_URL, authMode: "none" }],
		["stdio with a command and arguments", { transport: "stdio", command: "npx", args: ["-y", "srv"] }],
		// A row entering oauth mode legitimately holds no token yet.
		["oauth with no tokens", { transport: "http", url: UNREACHABLE_URL, authMode: "oauth" }],
	]

	for (const [label, columns] of accepted) {
		it(`accepts ${label}`, async () => {
			const agentId = await createAgent()
			await db.insert(mcpServer).values({ id: "probe", agentId, name: "probe", ...columns } as McpInsert)

			expect(await db.select({ id: mcpServer.id }).from(mcpServer).where(eq(mcpServer.id, "probe"))).toEqual([
				{ id: "probe" },
			])
		})
	}
})

describe("mcp server lifecycle", () => {
	it("keeps a failed probe from costing the operator their configuration", async () => {
		const agentId = await createAgent()
		const userId = await managerUserId()

		const created = await service.createServer(userId, agentId, {
			name: "Stock",
			transport: "http",
			url: UNREACHABLE_URL,
			authMode: "headers",
			headers: { "X-API-Key": "secret-value" },
		})

		expect(created.health).toBe("unhealthy")
		expect(created.healthDetail).toBeTruthy()
		expect(created.url).toBe(UNREACHABLE_URL)
		// The value is named but never returned.
		expect(created.headers).toEqual([{ name: "X-API-Key", hasValue: true }])
		expect(JSON.stringify(created)).not.toContain("secret-value")
	})

	it("rejects a duplicate name within one agent but not across two", async () => {
		const first = await createAgent()
		const second = await createAgent()
		const userId = await managerUserId()

		await service.createServer(userId, first, {
			name: "Stock",
			transport: "http",
			url: UNREACHABLE_URL,
			authMode: "none",
		})

		await expect(
			service.createServer(userId, first, {
				name: "stock",
				transport: "http",
				url: UNREACHABLE_URL,
				authMode: "none",
			}),
		).rejects.toBeInstanceOf(service.DuplicateMcpServerNameError)
		await expect(
			service.createServer(userId, second, {
				name: "Stock",
				transport: "http",
				url: UNREACHABLE_URL,
				authMode: "none",
			}),
		).resolves.toMatchObject({ name: "Stock" })
	})

	it("rejects a reserved header name and a non-http address", async () => {
		const agentId = await createAgent()
		const userId = await managerUserId()

		await expect(
			service.createServer(userId, agentId, {
				name: "Reserved",
				transport: "http",
				url: UNREACHABLE_URL,
				authMode: "headers",
				headers: { "MCP-Session-Id": "x" },
			}),
		).rejects.toBeInstanceOf(service.InvalidMcpServerError)
		await expect(
			service.createServer(userId, agentId, {
				name: "Bad scheme",
				transport: "http",
				url: "file:///etc/passwd",
				authMode: "none",
			}),
		).rejects.toBeInstanceOf(service.InvalidMcpServerError)
	})

	it("rejects a stale revision but not a write made since the read", async () => {
		const agentId = await createAgent()
		const userId = await managerUserId()
		const created = await service.createServer(userId, agentId, {
			name: "Stock",
			transport: "http",
			url: UNREACHABLE_URL,
			authMode: "none",
		})
		const body = { transport: "http" as const, url: UNREACHABLE_URL, authMode: "none" as const }

		await service.setServerDisabled(userId, agentId, created.id, true)

		// A probe or token refresh moves updatedAt but not revision, so this still applies.
		await expect(
			service.updateServer(userId, agentId, created.id, {
				...body,
				name: "Renamed",
				expectedRevision: created.revision,
			}),
		).resolves.toMatchObject({ name: "Renamed", isDisabled: true })
		await expect(
			service.updateServer(userId, agentId, created.id, {
				...body,
				name: "Again",
				expectedRevision: created.revision,
			}),
		).rejects.toBeInstanceOf(service.RevisionConflictError)
	})

	it("preserves a stored secret that an update does not mention", async () => {
		const agentId = await createAgent()
		const userId = await managerUserId()
		const created = await service.createServer(userId, agentId, {
			name: "Stock",
			transport: "http",
			url: UNREACHABLE_URL,
			authMode: "headers",
			headers: { "X-API-Key": "secret-value" },
		})

		// The dashboard never sees the value, so a rename cannot send it back.
		const renamed = await service.updateServer(userId, agentId, created.id, {
			name: "Stock v2",
			transport: "http",
			url: UNREACHABLE_URL,
			authMode: "headers",
			expectedRevision: created.revision,
		})

		expect(renamed.headers).toEqual([{ name: "X-API-Key", hasValue: true }])
		const [row] = await db.select({ headers: mcpServer.headers }).from(mcpServer).where(eq(mcpServer.id, created.id))
		expect(JSON.stringify(row?.headers)).not.toContain("secret-value")
	})

	it("excludes a disabled connection from tool resolution", async () => {
		const agentId = await createAgent()
		const userId = await managerUserId()
		const created = await service.createServer(userId, agentId, {
			name: "Stock",
			transport: "http",
			url: UNREACHABLE_URL,
			authMode: "none",
		})
		await db
			.update(mcpServer)
			.set({ tools: [{ name: "get_stock", description: "", selected: true }] })
			.where(eq(mcpServer.id, created.id))

		const controller = new AbortController()
		await service.setServerDisabled(userId, agentId, created.id, true)

		const disabled = await service.openTools(agentId, controller.signal)
		expect(disabled.tools).toEqual({})
		await disabled.close()
		// Reaching here at all proves the server was never contacted while disabled.
		await service.setServerDisabled(userId, agentId, created.id, false)
	})

	it("deletes a connection's secrets with the agent", async () => {
		const agentId = await createAgent()
		const userId = await managerUserId()
		await service.createServer(userId, agentId, {
			name: "Stock",
			transport: "http",
			url: UNREACHABLE_URL,
			authMode: "headers",
			headers: { "X-API-Key": "secret-value" },
		})

		await agent.deleteAgent(agentId)

		expect(await db.select({ id: mcpServer.id }).from(mcpServer)).toEqual([])
	})

	it("requires the permission the route checks", async () => {
		const agentId = await createAgent()
		const reader = await identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })
		await roles.grantPermission({
			userId: reader.id,
			permission: roles.Permission.AgentsRead,
			grantedBy: reader.id,
		})

		await expect(service.listServers(reader.id, agentId)).resolves.toEqual([])
		await expect(
			service.createServer(reader.id, agentId, {
				name: "Stock",
				transport: "http",
				url: UNREACHABLE_URL,
				authMode: "none",
			}),
		).rejects.toBeInstanceOf(service.PermissionDeniedError)
	})
})

describe("mcp routes", () => {
	it.each([
		["GET", "/api/agents/any/mcp-servers"],
		["POST", "/api/agents/any/mcp-servers"],
		["PUT", "/api/agents/any/mcp-servers/any"],
		["DELETE", "/api/agents/any/mcp-servers/any"],
		["POST", "/api/agents/any/mcp-servers/any/probe"],
		["POST", "/api/agents/any/mcp-servers/any/enable"],
		["POST", "/api/agents/any/mcp-servers/any/disable"],
	] as const)("requires a session for %s %s", async (method, path) => {
		expect((await app.request(path, { method })).status).toBe(401)
	})
})

const isRunning = async (pid: number) => Bun.file(`/proc/${pid}/stat`).exists()

/** close() kills the child; the reaping is asynchronous, so poll rather than sleep a fixed amount. */
async function waitUntilStopped(pid: number): Promise<boolean> {
	for (let attempt = 0; attempt < 40; attempt++) {
		// oxlint-disable-next-line no-await-in-loop -- polling one process, not independent work.
		if (!(await isRunning(pid))) return true
		// oxlint-disable-next-line no-await-in-loop -- poll interval.
		await Bun.sleep(25)
	}
	return false
}

/** Invokes the single resolved tool and unwraps the MCP content envelope. */
async function runOnlyTool(connection: service.OpenTools): Promise<Record<string, unknown>> {
	const [result] = await Promise.all(
		Object.values(connection.tools).map((tool) =>
			(tool as { execute?: (args: unknown, options: unknown) => Promise<unknown> }).execute?.(
				{},
				{ toolCallId: "1", messages: [] },
			),
		),
	)
	const content = (result as { content: { text: string }[] }).content
	return JSON.parse(content[0]!.text) as Record<string, unknown>
}

/** Invokes the single resolved tool with arguments and returns its unwrapped payload. */
async function runTool(connection: service.OpenTools, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const [result] = await Promise.all(
		Object.values(connection.tools).map((tool) =>
			(tool as { execute?: (args: unknown, options: unknown) => Promise<unknown> }).execute?.(args, {
				toolCallId: "1",
				messages: [],
			}),
		),
	)
	const content = (result as { content: { text: string }[] }).content
	return JSON.parse(content[0]!.text) as Record<string, unknown>
}

describe("stdio connections", () => {
	const DEMO_SCRIPT = "test-fixtures/mcp-demo-server.ts"

	async function createDemo(agentId: string, overrides: { env?: Record<string, string> } = {}) {
		return service.createServer(await managerUserId(), agentId, {
			name: "Demo shop",
			transport: "stdio",
			command: process.execPath,
			args: [DEMO_SCRIPT, "stdio"],
			env: {},
			...overrides,
		})
	}

	it("discovers the demo server's tools on create", async () => {
		const agentId = await createAgent()

		const created = await createDemo(agentId)

		expect(created.health).toBe("healthy")
		expect(created.tools.map(({ name }) => name)).toEqual(["get_stock_level", "list_orders", "report_environment"])
		// Nothing is selected until the operator chooses; the seed is what turns tools on.
		expect(created.tools.every((tool) => tool.selected)).toBe(false)
	})

	it("resolves callable tools that return the server's own answer", async () => {
		const agentId = await createAgent()
		await createDemo(agentId)
		await db
			.update(mcpServer)
			.set({ tools: [{ name: "get_stock_level", description: "", selected: true }] })
			.where(eq(mcpServer.name, "Demo shop"))

		const connection = await service.openTools(agentId, new AbortController().signal)
		expect(Object.keys(connection.tools)).toEqual(["Demo_shop__get_stock_level"])

		expect(await runTool(connection, { sku: "TALQO-TEA-001" })).toMatchObject({
			name: "Earl Grey, 100 bags",
			inStock: 42,
		})
		await connection.close()
	})

	it("stops the child process on close, and tolerates a second close", async () => {
		const agentId = await createAgent()
		await createDemo(agentId)
		await db
			.update(mcpServer)
			.set({ tools: [{ name: "report_environment", description: "", selected: true }] })
			.where(eq(mcpServer.name, "Demo shop"))

		const connection = await service.openTools(agentId, new AbortController().signal)
		const pid = (await runOnlyTool(connection)).pid as number
		expect(pid).toBeGreaterThan(0)
		expect(await isRunning(pid)).toBe(true)

		await connection.close()
		// Both an aborted and a throwing generation reach close, so it must be safe to repeat.
		await connection.close()

		expect(await waitUntilStopped(pid)).toBe(true)
	})

	it("never exposes Talqo's own secrets to an operator-chosen program", async () => {
		const agentId = await createAgent()
		await createDemo(agentId, { env: { DEMO_TOKEN: "operator-supplied" } })
		await db
			.update(mcpServer)
			.set({ tools: [{ name: "report_environment", description: "", selected: true }] })
			.where(eq(mcpServer.name, "Demo shop"))

		const connection = await service.openTools(agentId, new AbortController().signal)
		const reported = JSON.stringify(await runOnlyTool(connection))

		expect(reported).toContain("operator-supplied")
		expect(reported).not.toContain("APP_SECRET")
		expect(reported).not.toContain("DATABASE_URL")
		await connection.close()
	})
})
