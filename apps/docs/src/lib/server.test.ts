import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDocsResponder, resolveDocsPort } from "./server"

describe("docs listen port", () => {
	test("defaults to 3002 and accepts trimmed integer ports within the TCP range", () => {
		expect(resolveDocsPort(undefined)).toBe(3002)
		expect(resolveDocsPort(" 1 ")).toBe(1)
		expect(resolveDocsPort("65535")).toBe(65_535)
	})

	test("rejects invalid ports instead of silently listening elsewhere", () => {
		for (const value of ["", "0", "65536", "-1", "3002.5", "3002suffix"]) {
			expect(() => resolveDocsPort(value)).toThrow("TALQO_DOCS_PORT must be an integer")
		}
	})
})

describe("docs HTTP responder", () => {
	let directory: string
	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "talqo-docs-assets-"))
		await Bun.write(join(directory, "app.123.js"), "console.log('docs')")
	})
	afterAll(async () => {
		await rm(directory, { recursive: true, force: true })
	})

	test.each(["GET", "HEAD"])("serves %s assets with immutable caching, without calling SSR", async (method) => {
		const respond = createDocsResponder(() => {
			throw new Error("Assets must not reach SSR")
		}, directory)
		const response = await respond(new Request("https://docs.example/assets/app.123.js", { method }))
		expect(response.status).toBe(200)
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")
		expect(await response.text()).toBe("console.log('docs')")
	})

	test.each(["/assets/missing.js", "/assets//app.123.js", "/assets/"])(
		"returns 404 for %s without falling through to SSR",
		async (path) => {
			const respond = createDocsResponder(() => {
				throw new Error("Missing assets must not reach SSR")
			}, directory)
			const response = await respond(new Request(`https://docs.example${path}`))
			expect(response.status).toBe(404)
			expect(response.headers.has("Cache-Control")).toBe(false)
		},
	)

	test.each([
		new Request("https://docs.example/deployment?lang=en"),
		new Request("https://docs.example/assets/app.123.js", { method: "POST", body: "action" }),
	])("forwards non-assets and non-read requests unchanged to SSR", async (request) => {
		const rendered = new Response("SSR", { status: 202 })
		const respond = createDocsResponder((received) => {
			expect(received).toBe(request)
			return rendered
		}, directory)
		expect(await respond(request)).toBe(rendered)
	})
})
