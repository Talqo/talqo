import { afterEach, describe, expect, it } from "bun:test"

import { crawlWebsite, NetworkFamily, type WebsiteCrawlerDependencies, type WebsiteCrawlerLimits } from "./website-crawler.ts"

const PUBLIC_ADDRESS = { address: "93.184.216.34", family: NetworkFamily.IPv4 }
const LOOPBACK_ADDRESS = { address: "127.0.0.1", family: NetworkFamily.IPv4 }
const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
	if (originalNodeEnv === undefined) delete process.env.NODE_ENV
	else process.env.NODE_ENV = originalNodeEnv
})

function html(content = "<html><body>Page</body></html>"): Response {
	return new Response(content, { headers: { "Content-Type": "text/html; charset=utf-8" } })
}

function xml(content: string): Response {
	return new Response(content, { headers: { "Content-Type": "application/xml" } })
}

type Reply = Response | ((url: URL) => Response | Promise<Response>)

function fakeCrawler(routes: Record<string, Reply>, limits?: Partial<WebsiteCrawlerLimits>) {
	const requests: string[] = []
	const addresses: string[] = []
	const timeouts: number[] = []
	const dependencies: WebsiteCrawlerDependencies = {
		resolve: async () => [PUBLIC_ADDRESS],
		fetchResource: async (url, address, timeoutMs) => {
			const path = `${url.pathname}${url.search}`
			requests.push(path)
			addresses.push(address.address)
			timeouts.push(timeoutMs)
			const reply = routes[path]
			if (!reply) {
				if (path === "/robots.txt") return new Response(null, { status: 404 })
				return new Response("missing", { status: 404 })
			}
			return typeof reply === "function" ? reply(url) : reply
		},
		limits,
	}
	return { dependencies, requests, addresses, timeouts }
}

function paths(pages: Awaited<ReturnType<typeof crawlWebsite>>): string[] {
	return pages.map(({ url }) => {
		const parsed = new URL(url)
		return `${parsed.pathname}${parsed.search}`
	})
}

describe("website sitemaps", () => {
	it("follows nested same-origin indexes in order and decodes XML entities", async () => {
		const { dependencies } = fakeCrawler({
			"/root.xml": xml(`<sitemapindex>
				<sitemap><loc>https://example.test/one.xml?a=1&amp;b=2</loc></sitemap>
				<sitemap><loc>https://example.test/two.xml</loc></sitemap>
			</sitemapindex>`),
			"/one.xml?a=1&b=2": xml(`<urlset><url><loc>https://example.test/a#fragment</loc></url></urlset>`),
			"/two.xml": xml(`<urlset>
				<url><loc>https://example.test/a</loc></url>
				<url><loc>https://example.test/b?x=1&amp;y=2</loc></url>
				<url><loc>https://other.test/outside</loc></url>
			</urlset>`),
			"/a": html("A"),
			"/b?x=1&y=2": html("B"),
		})

		const pages = await crawlWebsite("https://example.test/root.xml", dependencies)

		expect(paths(pages)).toEqual(["/a", "/b?x=1&y=2"])
	})

	it("rejects malformed and non-sitemap XML documents", async () => {
		for (const document of [
			"<urlset><url>",
			"<urlset><url></urlset>",
			"<not-a-sitemap><loc>https://example.test/a</loc></not-a-sitemap>",
			"<!DOCTYPE urlset [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><urlset><url><loc>&xxe;</loc></url></urlset>",
		]) {
			const { dependencies, requests } = fakeCrawler({ "/root.xml": xml(document) })
			await expect(crawlWebsite("https://example.test/root.xml", dependencies)).rejects.toMatchObject({
				reason: "website-unreachable",
			})
			expect(requests).toEqual(["/robots.txt", "/root.xml"])
		}
	})

	it("fails rather than indexing only the first pages at the sitemap page cap", async () => {
		const { dependencies } = fakeCrawler(
			{
				"/root.xml": xml("<urlset><url><loc>https://example.test/a</loc></url><url><loc>https://example.test/b</loc></url></urlset>"),
				"/a": html("A"),
			},
			{ maxPages: 1 },
		)

		await expect(crawlWebsite("https://example.test/root.xml", dependencies)).rejects.toMatchObject({
			reason: "website-too-large",
		})
	})

	it("bounds nested sitemap indexes", async () => {
		const { dependencies } = fakeCrawler(
			{ "/root.xml": xml("<sitemapindex><sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>") },
			{ maxSitemaps: 0 },
		)
		await expect(crawlWebsite("https://example.test/root.xml", dependencies)).rejects.toMatchObject({
			reason: "website-too-large",
		})
	})
})

describe("website breadth-first crawling", () => {
	it("deduplicates fragments and enforces origin and path scope", async () => {
		const { dependencies, requests } = fakeCrawler({
			"/docs/": html(`<a href="/docs/a#one">one</a><a href="/docs/a#two">two</a>
				<a href="/docs/a?x=1#three">three</a><a href="mailto:a@example.test">mail</a>
				<a href="https://other.test/docs/other">other origin</a><a href="/outside">outside</a>`),
			"/docs/a": html("A"),
			"/docs/a?x=1": html("Query"),
		})

		const pages = await crawlWebsite("https://EXAMPLE.test:443/docs/../docs/#start", dependencies)

		expect(paths(pages)).toEqual(["/docs/", "/docs/a", "/docs/a?x=1"])
		expect(requests).not.toContain("/outside")
		const bodies = pages.map(({ html: bytes }) => new TextDecoder().decode(bytes))
		expect(bodies[0]).toContain('/docs/a#one')
		expect(bodies.slice(1)).toEqual(["A", "Query"])
	})

	it("enforces allow and disallow rules, including a more specific Talqo group", async () => {
		const robots = `User-agent: *
Disallow: /docs/
Allow: /docs/public

User-agent: Talqo
Disallow: /docs/private
Allow: /docs/special`
		const { dependencies, requests } = fakeCrawler({
			"/robots.txt": new Response(robots, { headers: { "Content-Type": "text/plain" } }),
			"/docs/": html(`<a href="/docs/private">private</a><a href="/docs/public">public</a>
				<a href="/docs/special">special</a>`),
			"/docs/public": html("Public"),
			"/docs/special": html("Special"),
		})

		const pages = await crawlWebsite("https://example.test/docs/", dependencies)

		expect(paths(pages)).toEqual(["/docs/", "/docs/public", "/docs/special"])
		expect(requests).not.toContain("/docs/private")
	})

	it("fails on an off-scope redirect", async () => {
		const { dependencies } = fakeCrawler({
			"/docs/": new Response(null, { status: 302, headers: { Location: "https://other.test/docs/" } }),
		})
		await expect(crawlWebsite("https://example.test/docs/", dependencies)).rejects.toMatchObject({
			reason: "website-blocked",
		})
	})

	it("bounds redirect chains", async () => {
		const { dependencies } = fakeCrawler(
			{ "/docs/": new Response(null, { status: 302, headers: { Location: "/docs/" } }) },
			{ maxRedirects: 0 },
		)
		await expect(crawlWebsite("https://example.test/docs/", dependencies)).rejects.toMatchObject({
			reason: "website-too-large",
		})
	})

	it("fails with pending in-scope pages at the page cap", async () => {
		const { dependencies } = fakeCrawler(
			{
				"/docs/": html('<a href="/docs/a">A</a><a href="/docs/b">B</a>'),
				"/docs/a": html("A"),
			},
			{ maxPages: 1 },
		)
		await expect(crawlWebsite("https://example.test/docs/", dependencies)).rejects.toMatchObject({
			reason: "website-too-large",
		})
	})

	it("allows exactly the page cap", async () => {
		const { dependencies } = fakeCrawler(
			{
				"/docs/": html('<a href="/docs/a">A</a>'),
				"/docs/a": html("A"),
			},
			{ maxPages: 2 },
		)
		await expect(crawlWebsite("https://example.test/docs/", dependencies)).resolves.toHaveLength(2)
	})
})

describe("website network and response safety", () => {
	it("rejects private, loopback, link-local, and IPv4-mapped addresses in production", async () => {
		process.env.NODE_ENV = "production"
		for (const host of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "[::ffff:127.0.0.1]"]) {
			const { dependencies, requests } = fakeCrawler({})
			await expect(crawlWebsite(`http://${host}/`, dependencies)).rejects.toMatchObject({ reason: "website-blocked" })
			expect(requests).toEqual([])
		}
	})

	it("rejects a hostname that resolves to any non-public address", async () => {
		process.env.NODE_ENV = "production"
		const { dependencies, requests } = fakeCrawler({})
		dependencies.resolve = async () => [PUBLIC_ADDRESS, LOOPBACK_ADDRESS]
		await expect(crawlWebsite("https://example.test/", dependencies)).rejects.toMatchObject({
			reason: "website-blocked",
		})
		expect(requests).toEqual([])
	})

	it("re-resolves every discovered page and rejects a DNS change", async () => {
		process.env.NODE_ENV = "production"
		const { dependencies } = fakeCrawler({
			"/": html('<a href="/next">next</a>'),
		})
		const resolutions = [[PUBLIC_ADDRESS], [PUBLIC_ADDRESS], [LOOPBACK_ADDRESS]]
		dependencies.resolve = async () => resolutions.shift() ?? [PUBLIC_ADDRESS]
		await expect(crawlWebsite("https://example.test/", dependencies)).rejects.toMatchObject({
			reason: "website-blocked",
		})
		expect(resolutions).toHaveLength(0)
	})

	it("uses the validated resolved address for the actual connection", async () => {
		process.env.NODE_ENV = "test"
		const hosts: Array<string | null> = []
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const { pathname } = new URL(request.url)
				hosts.push(request.headers.get("host"))
				if (pathname === "/robots.txt") return new Response(null, { status: 404 })
				if (pathname === "/docs/") return html("Pinned")
				return new Response(null, { status: 404 })
			},
		})
		try {
			const pages = await crawlWebsite(`http://public-fixture.test:${server.port}/docs/`, {
				resolve: async () => [LOOPBACK_ADDRESS],
			})
			expect(new TextDecoder().decode(pages[0]?.html)).toBe("Pinned")
			expect(hosts).toEqual([`public-fixture.test:${server.port}`, `public-fixture.test:${server.port}`])
		} finally {
			await server.stop(true)
		}
	})

	it("rejects non-HTML pages", async () => {
		const { dependencies } = fakeCrawler({
			"/": new Response("{}", { headers: { "Content-Type": "application/json" } }),
		})
		await expect(crawlWebsite("https://example.test/", dependencies)).rejects.toMatchObject({
			reason: "website-unreachable",
		})
	})

	it("rejects oversized declared and streamed page bodies", async () => {
		const declared = fakeCrawler({ "/": html("12345") }, { maxHtmlBytes: 4 })
		await expect(crawlWebsite("https://example.test/", declared.dependencies)).rejects.toMatchObject({
			reason: "website-too-large",
		})
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("12345"))
				controller.close()
			},
		})
		const streamed = fakeCrawler(
			{ "/": new Response(stream, { headers: { "Content-Type": "text/html" } }) },
			{ maxHtmlBytes: 4 },
		)
		await expect(crawlWebsite("https://example.test/", streamed.dependencies)).rejects.toMatchObject({
			reason: "website-too-large",
		})
	})

	it("rejects oversized sitemaps and total HTML", async () => {
		const sitemap = fakeCrawler({ "/root.xml": xml("<urlset></urlset>") }, { maxSitemapBytes: 4 })
		await expect(crawlWebsite("https://example.test/root.xml", sitemap.dependencies)).rejects.toMatchObject({
			reason: "website-too-large",
		})
		const total = fakeCrawler(
			{ "/": html('<a href="/next">1</a>'), "/next": html("12345") },
			{ maxHtmlBytes: 100, maxTotalHtmlBytes: 25 },
		)
		await expect(crawlWebsite("https://example.test/", total.dependencies)).rejects.toMatchObject({
			reason: "website-too-large",
		})
	})

	it("bounds per-request and overall time", async () => {
		const perRequest = fakeCrawler({ "/": html() }, { requestTimeoutMs: 123, overallTimeoutMs: 1_000 })
		await expect(crawlWebsite("https://example.test/", perRequest.dependencies)).resolves.toHaveLength(1)
		expect(perRequest.timeouts).toEqual([123, 123])

		let time = 0
		const overall = fakeCrawler({}, { overallTimeoutMs: 100 })
		overall.dependencies.now = () => {
			time += 60
			return time
		}
		await expect(crawlWebsite("https://example.test/", overall.dependencies)).rejects.toMatchObject({
			reason: "website-unreachable",
		})
	})

	it("rejects canonical URLs beyond the character cap", async () => {
		const { dependencies } = fakeCrawler({
			"/": html(`<a href="/${"a".repeat(2_048)}">too long</a>`),
		})
		await expect(crawlWebsite("https://example.test/", dependencies)).rejects.toMatchObject({
			reason: "website-too-large",
		})
	})
})
