import type { McpServer } from "@/api/generated/models/mcpServer.zod"

import { describe, expect, test } from "bun:test"

import {
	EMPTY_DRAFT,
	toCreateBody,
	toEditBody,
	toUpdateBody,
	toggleTool,
	toggledBody,
	type ConnectionDraft,
} from "./connection-body"

function server(overrides: Partial<McpServer> = {}): McpServer {
	return {
		id: "srv",
		name: "Stock",
		transport: "http",
		url: "https://example.test/mcp",
		authMode: "none",
		command: null,
		args: [],
		headers: [],
		env: [],
		tools: [],
		toolCount: 0,
		isWorking: true,
		isDisabled: false,
		revision: 4,
		...overrides,
	}
}

function draft(patch: Partial<ConnectionDraft> = {}): ConnectionDraft {
	return { ...EMPTY_DRAFT, name: "Stock", ...patch }
}

describe("toCreateBody", () => {
	test("builds an http body with no credentials by default", () => {
		expect(toCreateBody(draft({ url: "https://example.test/mcp" }))).toEqual({
			ok: true,
			body: { name: "Stock", server: { transport: "http", url: "https://example.test/mcp", authMode: "none" } },
		})
	})

	test("sends every entered header", () => {
		expect(
			toCreateBody(
				draft({
					url: "https://example.test/mcp",
					authMode: "headers",
					headers: [
						{ id: "h1", name: "X-API-Key", value: "k" },
						{ id: "h2", name: "X-Tenant", value: "t" },
					],
				}),
			),
		).toMatchObject({
			ok: true,
			body: { server: { authMode: "headers", headers: { "X-API-Key": "k", "X-Tenant": "t" } } },
		})
	})

	test("builds a stdio body with one variable", () => {
		expect(
			toCreateBody(
				draft({
					transport: "stdio",
					command: "bunx",
					args: [
						{ id: "a1", value: "-y" },
						{ id: "a2", value: "@scope/server" },
					],
					env: [{ id: "k1", name: "KEY", value: "v" }],
				}),
			),
		).toMatchObject({
			ok: true,
			body: { server: { transport: "stdio", command: "bunx", args: ["-y", "@scope/server"], env: { KEY: "v" } } },
		})
	})

	test("refuses an incomplete form instead of sending half of it", () => {
		expect(toCreateBody(EMPTY_DRAFT)).toEqual({ ok: false, reason: "nameRequired" })
		expect(toCreateBody(draft())).toEqual({ ok: false, reason: "addressRequired" })
		expect(toCreateBody(draft({ transport: "stdio" }))).toEqual({ ok: false, reason: "commandRequired" })
		expect(
			toCreateBody(
				draft({
					url: "https://example.test/mcp",
					authMode: "headers",
					headers: [{ id: "h1", name: "X-API-Key", value: "" }],
				}),
			),
		).toEqual({ ok: false, reason: "secretRequired" })
	})
})

describe("toUpdateBody", () => {
	test("assembles the body the dialog hands it without touching secrets", () => {
		const body = toUpdateBody({
			name: "Stock",
			revision: 4,
			isDisabled: false,
			server: { transport: "http", url: "https://example.test/mcp", authMode: "none" },
		})

		expect(body).toEqual({
			name: "Stock",
			expectedRevision: 4,
			isDisabled: false,
			server: { transport: "http", url: "https://example.test/mcp", authMode: "none" },
		})
	})

	test("omits the tools list the dialog never sends", () => {
		expect(
			toUpdateBody({
				name: "Stock",
				revision: 4,
				isDisabled: false,
				server: { transport: "http", url: "https://example.test/mcp", authMode: "none" },
			}),
		).not.toHaveProperty("tools")
	})
})

describe("toggledBody", () => {
	test("never resends a secret the operator cannot see", () => {
		const body = toggledBody(
			server({ authMode: "headers", headers: [{ name: "X-API-Key", hasValue: true }] }),
			"get_stock",
			false,
		)

		// Sending the masked shape as a value would erase the stored secret.
		expect(body.server).toEqual({ transport: "http", url: "https://example.test/mcp", authMode: "headers" })
		expect(body.server).not.toHaveProperty("headers")
	})

	test("omits stdio environment variables for the same reason", () => {
		const body = toggledBody(
			server({ transport: "stdio", url: null, authMode: null, command: "npx", env: [{ name: "KEY", hasValue: true }] }),
			"get_stock",
			false,
		)

		expect(body.server).toEqual({ transport: "stdio", command: "npx", args: [] })
	})

	test("carries the revision so a concurrent edit is still detected", () => {
		expect(toggledBody(server(), "get_stock", false).expectedRevision).toBe(4)
	})

	test("flips one tool and leaves every other selection alone", () => {
		const tools = [
			{ name: "get_stock", description: "", selected: true },
			{ name: "get_price", description: "", selected: false },
		]
		const body = toggledBody(server({ tools }), "get_price", true)

		expect(body.tools).toEqual([
			{ name: "get_stock", selected: true },
			{ name: "get_price", selected: true },
		])
	})
})

describe("toggleTool", () => {
	test("changes only the named tool", () => {
		const tools = [
			{ name: "get_stock", description: "", selected: true },
			{ name: "get_price", description: "", selected: true },
		]

		expect(toggleTool(tools, "get_price", false)).toEqual([
			{ name: "get_stock", description: "", selected: true },
			{ name: "get_price", description: "", selected: false },
		])
	})
})

function edit(
	patch: Partial<ConnectionDraft> = {},
	stored: { headers?: { name: string }[]; env?: { name: string }[] } = {},
) {
	return toEditBody(
		{ ...EMPTY_DRAFT, name: "Stock", url: "https://example.test/mcp", ...patch },
		{
			isDisabled: true,
			revision: 7,
			headers: [],
			env: [],
			...stored,
		},
	)
}

describe("toEditBody", () => {
	test("keeps the revision and the disabled flag", () => {
		expect(edit()).toMatchObject({ ok: true, body: { expectedRevision: 7, isDisabled: true, name: "Stock" } })
	})

	test("leaves a stored secret alone when the operator leaves the value blank", () => {
		const body = edit(
			{ authMode: "headers", headers: [{ id: "h1", name: "X-API-Key", value: "" }] },
			{ headers: [{ name: "X-API-Key" }] },
		)

		expect(body).toMatchObject({ ok: true, body: { server: { authMode: "headers" } } })
		// Sending the masked shape would replace the stored value with an empty one.
		expect((body as { body: { server: object } }).body.server).not.toHaveProperty("headers")
		expect((body as { body: { server: object } }).body.server).not.toHaveProperty("deleteHeaders")
	})

	test("sends a newly typed secret", () => {
		expect(edit({ authMode: "headers", headers: [{ id: "h1", name: "X-API-Key", value: "v" }] })).toMatchObject({
			ok: true,
			body: { server: { headers: { "X-API-Key": "v" } } },
		})
	})

	test("deletes a stored secret whose row the operator removed", () => {
		expect(edit({ authMode: "headers", headers: [] }, { headers: [{ name: "X-API-Key" }] })).toMatchObject({
			ok: true,
			body: { server: { deleteHeaders: ["X-API-Key"] } },
		})
	})

	test("forgets the old name when a header is replaced", () => {
		expect(
			edit(
				{ authMode: "headers", headers: [{ id: "h2", name: "X-New-Key", value: "v" }] },
				{ headers: [{ name: "X-API-Key" }] },
			),
		).toMatchObject({
			ok: true,
			body: { server: { headers: { "X-New-Key": "v" }, deleteHeaders: ["X-API-Key"] } },
		})
	})

	test("refuses a value with no name instead of silently dropping it", () => {
		expect(edit({ authMode: "headers", headers: [{ id: "h1", name: "", value: "v" }] })).toEqual({
			ok: false,
			reason: "secretRequired",
		})
	})
})

describe("env variables", () => {
	test("keeps every variable the operator added", () => {
		const body = toCreateBody(
			draft({
				transport: "stdio",
				command: "bunx",
				env: [
					{ id: "e1", name: "API_KEY", value: "one" },
					{ id: "e2", name: "REGION", value: "eu" },
				],
			}),
		)

		expect(body).toMatchObject({ ok: true, body: { server: { env: { API_KEY: "one", REGION: "eu" } } } })
	})

	test("leaves a variable with no value out so the stored one survives", () => {
		const body = toEditBody(
			{
				...EMPTY_DRAFT,
				name: "Shop",
				transport: "stdio",
				command: "bunx",
				env: [{ id: "e1", name: "API_KEY", value: "" }],
			},
			{ isDisabled: false, revision: 1, headers: [], env: [{ name: "API_KEY" }] },
		)

		expect((body as { body: { server: object } }).body.server).not.toHaveProperty("env")
		expect((body as { body: { server: object } }).body.server).not.toHaveProperty("deleteEnv")
	})

	test("deletes a variable whose row the operator removed", () => {
		const body = toEditBody(
			{
				...EMPTY_DRAFT,
				name: "Shop",
				transport: "stdio",
				command: "bunx",
				env: [{ id: "e3", name: "REGION", value: "" }],
			},
			{ isDisabled: false, revision: 1, headers: [], env: [{ name: "API_KEY" }, { name: "REGION" }] },
		)

		expect(body).toMatchObject({ ok: true, body: { server: { deleteEnv: ["API_KEY"] } } })
	})

	test("sends an entered value without forgetting the untouched variables", () => {
		const body = toEditBody(
			{
				...EMPTY_DRAFT,
				name: "Shop",
				transport: "stdio",
				command: "bunx",
				env: [
					{ id: "e1", name: "API_KEY", value: "" },
					{ id: "e2", name: "REGION", value: "eu" },
				],
			},
			{ isDisabled: false, revision: 1, headers: [], env: [{ name: "API_KEY" }] },
		)

		expect(body).toMatchObject({ ok: true, body: { server: { env: { REGION: "eu" } } } })
		expect((body as { body: { server: object } }).body.server).not.toHaveProperty("deleteEnv")
	})

	test("ignores an untouched empty row instead of blocking the save", () => {
		const body = toCreateBody(
			draft({
				transport: "stdio",
				command: "bunx",
				env: [
					{ id: "e1", name: "API_KEY", value: "one" },
					{ id: "e0", name: "", value: "" },
				],
			}),
		)

		expect(body).toMatchObject({ ok: true, body: { server: { env: { API_KEY: "one" } } } })
	})

	test("refuses a half-filled variable instead of silently dropping it", () => {
		expect(
			toCreateBody(draft({ transport: "stdio", command: "bunx", env: [{ id: "e0", name: "", value: "orphan" }] })),
		).toEqual({ ok: false, reason: "secretRequired" })
		expect(
			toCreateBody(draft({ transport: "stdio", command: "bunx", env: [{ id: "e1", name: "API_KEY", value: "" }] })),
		).toEqual({ ok: false, reason: "secretRequired" })
	})

	test("trims arguments and collapses blanks and repeats", () => {
		const body = toCreateBody(
			draft({
				transport: "stdio",
				command: "bunx",
				args: [
					{ id: "a1", value: "-y" },
					{ id: "a2", value: "" },
					{ id: "a3", value: "  -y  " },
					{ id: "a4", value: "@scope/server" },
				],
			}),
		)

		expect(body).toMatchObject({ ok: true, body: { server: { args: ["-y", "@scope/server"] } } })
	})
})
