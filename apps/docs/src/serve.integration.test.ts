import { describe, expect, it } from "bun:test"
import { readdir } from "node:fs/promises"
import { join } from "node:path"

import { PROBLEMS } from "./lib/problem-catalog.ts"

const DIST_DIR = join(import.meta.dir, "..", "dist")
const CONTENT_DIR = join(import.meta.dir, "..", "content", "docs")

// Built artifact, so it only exists after `bun run build`.
const { default: app } = (await import(join(DIST_DIR, "server", "server.js"))) as {
	default: { fetch: (request: Request) => Promise<Response> }
}

function request(path: string): Promise<Response> {
	return app.fetch(new Request(new URL(path, "http://localhost")))
}

async function get(path: string): Promise<{ status: number; html: string }> {
	const response = await request(path)

	return { status: response.status, html: renderedText(await response.text()) }
}

// React separates adjacent text nodes with comment markers, so `problems#` and the
// code that follows it are not one literal run of text in the server-rendered HTML.
function renderedText(html: string): string {
	return html.replaceAll("<!-- -->", "")
}

async function docUrls(): Promise<string[]> {
	const files = await readdir(CONTENT_DIR)

	return files
		.filter((file) => /\.mdx?$/.test(file))
		.map((file) => {
			const slug = file.replace(/\.mdx?$/, "")
			return slug === "index" ? "/" : `/${slug}`
		})
}

async function statusesOf(paths: string[]): Promise<Map<string, number>> {
	const results = await Promise.all(paths.map(async (path) => [path, (await get(path)).status] as const))

	return new Map(results)
}

describe("docs routes", () => {
	it("renders every page in the content directory", async () => {
		const urls = await docUrls()
		expect(urls.length).toBeGreaterThan(1)

		const pages = await Promise.all(
			urls.map(async (url) => {
				const { status, html } = await get(url)

				return { url, status, html }
			}),
		)

		for (const page of pages) {
			expect(page.status, page.url).toBe(200)
			expect(page.html, page.url).toContain("<h1")
		}
	})

	it("does not render a link to an address that 404s", async () => {
		const index = (await get("/")).html
		const links = [
			...new Set(
				[...index.matchAll(/href="(\/[^"#]*)"/g)]
					.map((match) => match[1])
					.filter((link): link is string => link !== undefined && !link.startsWith("/assets/")),
			),
		]

		expect(links.length).toBeGreaterThan(1)

		for (const [link, status] of await statusesOf(links)) {
			expect(status, link).toBeLessThan(400)
		}
	})

	it("does not find a slug that is not in the content directory", async () => {
		expect((await get("/does-not-exist")).status).toBe(404)
	})
})

describe("problem types", () => {
	it("serves every problem type URI that API errors point at", async () => {
		const { html } = await get("/problems")

		for (const problem of PROBLEMS) {
			expect(html).toContain(`https://docs.talqo.chat/problems#${problem.code}`)
		}
	})
})
