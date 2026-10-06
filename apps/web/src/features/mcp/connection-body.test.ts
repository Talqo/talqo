import type { McpServer } from "@/api/generated/models/mcpServer.zod"

import { describe, expect, test } from "bun:test"

import {
	EMPTY_DRAFT,
	toCreateBody,
	toEditBody,
	toUpdateBody,
	toggleTool,
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

	test("sends a single header when sign-in is a secret key", () => {
		expect(
			toCreateBody(
				draft({ url: "https://example.test/mcp", authMode: "headers", headerName: "X-API-Key", headerValue: "k" }),
			),
		).toMatchObject({
			ok: true,
			body: { server: { authMode: "headers", headers: { "X-API-Key": "k" } } },
		})
	})

	test("builds a stdio body with one variable", () => {
		expect(
			toCreateBody(
				draft({
					transport: "stdio",
					command: "bunx",
					args: ["-y", "@scope/server"],
					env: [{ name: "KEY", value: "v" }],
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
			toCreateBody(draft({ url: "https://example.test/mcp", authMode: "headers", headerName: "X-API-Key" })),
		).toEqual({ ok: false, reason: "secretRequired" })
	})
})

describe("toUpdateBody", () => {
	test("never resends a secret the operator cannot see", () => {
		const body = toUpdateBody(server({ authMode: "headers", headers: [{ name: "X-API-Key", hasValue: true }] }))

		// Sending the masked shape as a value would erase the stored secret.
		expect(body.server).toEqual({ transport: "http", url: "https://example.test/mcp", authMode: "headers" })
		expect(body.server).not.toHaveProperty("headers")
	})

	test("omits stdio environment variables for the same reason", () => {
		const body = toUpdateBody(
			server({ transport: "stdio", url: null, authMode: null, command: "npx", env: [{ name: "KEY", hasValue: true }] }),
		)

		expect(body.server).toEqual({ transport: "stdio", command: "npx", args: [] })
	})

	test("carries the revision so a concurrent edit is still detected", () => {
		expect(toUpdateBody(server()).expectedRevision).toBe(4)
	})

	test("applies an enabled toggle without dropping the selection", () => {
		const tools = [
			{ name: "get_stock", description: "", selected: true },
			{ name: "get_price", description: "", selected: false },
		]
		const body = toUpdateBody(server({ tools }), { isDisabled: true })

		expect(body.isDisabled).toBe(true)
		expect(body.tools).toEqual([
			{ name: "get_stock", selected: true },
			{ name: "get_price", selected: false },
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

function edit(patch: Partial<ConnectionDraft> = {}) {
	return toEditBody(
		{ ...EMPTY_DRAFT, name: "Stock", url: "https://example.test/mcp", ...patch },
		{
			isDisabled: true,
			revision: 7,
		},
	)
}

describe("toEditBody", () => {
	test("keeps the revision and the disabled flag", () => {
		expect(edit()).toMatchObject({ ok: true, body: { expectedRevision: 7, isDisabled: true, name: "Stock" } })
	})

	test("leaves a stored secret alone when the operator leaves the value blank", () => {
		const body = edit({ authMode: "headers", headerName: "X-API-Key" })

		expect(body).toMatchObject({ ok: true, body: { server: { authMode: "headers" } } })
		// Sending the masked shape would replace the stored value with an empty one.
		expect((body as { body: { server: object } }).body.server).not.toHaveProperty("headers")
	})

	test("sends a newly typed secret", () => {
		expect(edit({ authMode: "headers", headerName: "X-API-Key", headerValue: "v" })).toMatchObject({
			ok: true,
			body: { server: { headers: { "X-API-Key": "v" } } },
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
					{ name: "API_KEY", value: "one" },
					{ name: "REGION", value: "eu" },
				],
			}),
		)

		expect(body).toMatchObject({ ok: true, body: { server: { env: { API_KEY: "one", REGION: "eu" } } } })
	})

	test("leaves a variable with no value out so the stored one survives", () => {
		const body = toEditBody(
			{ ...EMPTY_DRAFT, name: "Shop", transport: "stdio", command: "bunx", env: [{ name: "API_KEY", value: "" }] },
			{ isDisabled: false, revision: 1 },
		)

		expect((body as { body: { server: object } }).body.server).not.toHaveProperty("env")
	})
})
