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
			return slug === "index" ? "/docs" : `/docs/${slug}`
		})
}

// The sidebar advertises every page in the content directory, so a page without a
// route is a dead link rather than a missing feature.
describe("docs routes", () => {
	it("renders every page in the content directory", async () => {
		const urls = await docUrls()
		expect(urls.length).toBeGreaterThan(1)

		const pages = await Promise.all(
			urls.map(async (url) => {
				const response = await request(url)
				return { url, status: response.status, html: await response.text() }
			}),
		)

		for (const page of pages) {
			expect(page.status, page.url).toBe(200)
			expect(page.html, page.url).toContain("<h1")
		}
	})

	it("redirects the site root to the docs index", async () => {
		const response = await request("/")

		expect(response.status).toBe(307)
		expect(response.headers.get("location")).toBe("/docs")
	})

	it("does not find a slug that is not in the content directory", async () => {
		expect((await request("/docs/does-not-exist")).status).toBe(404)
	})
})

describe("problem types", () => {
	it("serves every problem type URI that API errors point at", async () => {
		const html = renderedText(await (await request("/problems")).text())

		for (const problem of PROBLEMS) {
			expect(html).toContain(`https://docs.talqo.chat/problems#${problem.code}`)
		}
	})
})
