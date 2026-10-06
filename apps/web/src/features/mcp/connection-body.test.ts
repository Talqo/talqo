import type { McpServer } from "@/api/generated/models/mcpServer.zod"

import { describe, expect, test } from "bun:test"

import { EMPTY_DRAFT, parseArgs, toCreateBody, toUpdateBody, toggleTool, type ConnectionDraft } from "./connection-body"

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
		health: "healthy",
		healthDetail: null,
		isDisabled: false,
		revision: 4,
		...overrides,
	}
}

describe("parseArgs", () => {
	test("takes one argument per line and ignores blank ones", () => {
		expect(parseArgs("-y\n\n  @scope/server  \n")).toEqual(["-y", "@scope/server"])
	})

	test("keeps an argument containing spaces intact", () => {
		expect(parseArgs("run server --port 3000")).toEqual(["run server --port 3000"])
	})
})

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
				draft({ transport: "stdio", command: "npx", args: "-y\n@scope/server", envName: "KEY", envValue: "v" }),
			),
		).toMatchObject({
			ok: true,
			body: { server: { transport: "stdio", command: "npx", args: ["-y", "@scope/server"], env: { KEY: "v" } } },
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
