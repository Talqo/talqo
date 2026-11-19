import { lookup } from "node:dns"
import { request as httpRequest, type RequestOptions } from "node:http"
import { request as httpsRequest } from "node:https"
import { Readable } from "node:stream"
import { XMLParser, XMLValidator } from "fast-xml-parser"
import { DomUtils, parseDocument } from "htmlparser2"
import ipaddr from "ipaddr.js"

import { HTTP_STATUS } from "@/http/status.ts"

export enum NetworkFamily {
	IPv4 = 4,
	IPv6 = 6,
}
enum ByteSize {
	Megabyte = 1_048_576,
	HtmlMegabytes = 2,
	TotalHtmlMegabytes = 20,
	SitemapMegabytes = 5,
}
enum RedirectStatus {
	MovedPermanently = 301,
	Found = 302,
	SeeOther = 303,
	Temporary = 307,
	Permanent = 308,
}

export const MAX_WEBSITE_URL_LENGTH = 2_048
export const MAX_WEBSITE_PAGES = 50
const MAX_HTML_BYTES = ByteSize.HtmlMegabytes * ByteSize.Megabyte
const MAX_TOTAL_HTML_BYTES = ByteSize.TotalHtmlMegabytes * ByteSize.Megabyte
const MAX_SITEMAP_BYTES = ByteSize.SitemapMegabytes * ByteSize.Megabyte
const MAX_SITEMAPS = 20
const MAX_SITEMAP_DEPTH = 5
const MAX_REDIRECTS = 5
const MAX_DISCOVERED_PAGES = 5_000
const REQUEST_TIMEOUT_MS = 15_000
const OVERALL_TIMEOUT_MS = 120_000
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" }
const REDIRECT_STATUSES = new Set<number>([
	RedirectStatus.MovedPermanently,
	RedirectStatus.Found,
	RedirectStatus.SeeOther,
	RedirectStatus.Temporary,
	RedirectStatus.Permanent,
])
const XML_CONTENT_TYPES = new Set(["application/xml", "text/xml", "application/rss+xml"])
const HTML_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"])

export type WebsiteCrawlFailure = "website-blocked" | "website-unreachable" | "website-too-large"
export type CrawledPage = { url: string; html: Uint8Array }
type ResolvedAddress = { address: string; family: NetworkFamily }
type Resolve = (hostname: string) => Promise<ResolvedAddress[]>
type FetchResource = (url: URL, address: ResolvedAddress, timeoutMs: number) => Promise<Response>

export type WebsiteCrawlerLimits = {
	maxPages: number
	maxHtmlBytes: number
	maxTotalHtmlBytes: number
	maxSitemapBytes: number
	maxSitemaps: number
	maxSitemapDepth: number
	maxRedirects: number
	maxDiscoveredPages: number
	requestTimeoutMs: number
	overallTimeoutMs: number
}

export type WebsiteCrawlerDependencies = {
	resolve?: Resolve
	fetchResource?: FetchResource
	now?: () => number
	limits?: Partial<WebsiteCrawlerLimits>
}

const DEFAULT_LIMITS: WebsiteCrawlerLimits = {
	maxPages: MAX_WEBSITE_PAGES,
	maxHtmlBytes: MAX_HTML_BYTES,
	maxTotalHtmlBytes: MAX_TOTAL_HTML_BYTES,
	maxSitemapBytes: MAX_SITEMAP_BYTES,
	maxSitemaps: MAX_SITEMAPS,
	maxSitemapDepth: MAX_SITEMAP_DEPTH,
	maxRedirects: MAX_REDIRECTS,
	maxDiscoveredPages: MAX_DISCOVERED_PAGES,
	requestTimeoutMs: REQUEST_TIMEOUT_MS,
	overallTimeoutMs: OVERALL_TIMEOUT_MS,
}

export class WebsiteCrawlError extends Error {
	constructor(readonly reason: WebsiteCrawlFailure) {
		super(reason)
	}
}

function blocked(): never {
	throw new WebsiteCrawlError("website-blocked")
}

function unreachable(): never {
	throw new WebsiteCrawlError("website-unreachable")
}

function tooLarge(): never {
	throw new WebsiteCrawlError("website-too-large")
}

export function canonicalWebsiteUrl(input: string | URL, base?: URL): string {
	let url: URL
	try {
		url = input instanceof URL ? new URL(input) : new URL(input.trim(), base)
	} catch {
		return blocked()
	}
	if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) blocked()
	url.hash = ""
	const canonical = url.href
	if (canonical.length > MAX_WEBSITE_URL_LENGTH) tooLarge()
	return canonical
}

function mediaType(response: Response): string {
	return (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

function isSitemapLocation(url: URL, response?: Response): boolean {
	return url.pathname.toLowerCase().endsWith(".xml") || (response ? XML_CONTENT_TYPES.has(mediaType(response)) : false)
}

function isPublicAddress(value: string): boolean {
	let parsed: ipaddr.IPv4 | ipaddr.IPv6
	try {
		parsed = ipaddr.parse(value)
	} catch {
		return false
	}
	const address = parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
		? (parsed as ipaddr.IPv6).toIPv4Address()
		: parsed
	const range = address.range()
	if (range === "loopback") return process.env.NODE_ENV === "test"
	return address.kind() === "ipv4" ? range === "unicast" : range === "unicast"
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
	const addresses = await new Promise<ResolvedAddress[]>((resolve, reject) => {
		lookup(hostname, { all: true, verbatim: true }, (error, found) => {
			if (error) {
				reject(error)
				return
			}
			resolve(
				found.flatMap(({ address, family }) =>
					family === NetworkFamily.IPv4 || family === NetworkFamily.IPv6 ? [{ address, family }] : [],
				),
			)
		})
	})
	return addresses
}

async function resolvePublicAddress(url: URL, resolve: Resolve): Promise<ResolvedAddress> {
	const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname
	let addresses: ResolvedAddress[]
	if (ipaddr.isValid(hostname)) {
		const parsed = ipaddr.parse(hostname)
		addresses = [{ address: parsed.toNormalizedString(), family: parsed.kind() === "ipv4" ? NetworkFamily.IPv4 : NetworkFamily.IPv6 }]
	} else {
		try {
			addresses = await resolve(hostname)
		} catch {
			return unreachable()
		}
	}
	if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) blocked()
	const selected = addresses[0]
	if (!selected) blocked()
	return selected
}

function requestTarget(url: URL, address: ResolvedAddress): RequestOptions & { servername: string } {
	const port = url.port ? Number(url.port) : Number(DEFAULT_PORTS[url.protocol])
	return {
		protocol: url.protocol,
		hostname: address.address,
		family: address.family,
		port,
		path: `${url.pathname}${url.search}`,
		method: "GET",
		servername: url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname,
		headers: {
			Accept: "text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.8,*/*;q=0.1",
			"Accept-Encoding": "identity",
			Host: url.host,
			"User-Agent": "Talqo/1.0",
		},
	}
}

async function defaultFetchResource(url: URL, address: ResolvedAddress, timeoutMs: number): Promise<Response> {
	return new Promise<Response>((resolve, reject) => {
		const options = requestTarget(url, address)
		const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(options, (response) => {
			const headers = new Headers()
			for (const [name, value] of Object.entries(response.headers)) {
				if (Array.isArray(value)) {
					for (const item of value) headers.append(name, item)
				} else if (value !== undefined) headers.set(name, value)
			}
			const body = Readable.toWeb(response) as ReadableStream<Uint8Array>
			resolve(new Response(body, { status: response.statusCode ?? HTTP_STATUS.INTERNAL_SERVER_ERROR, headers }))
		})
		request.setTimeout(timeoutMs, () => request.destroy(new Error("Website request timed out")))
		request.on("error", reject)
		request.end()
	})
}

type FetchedResource = { url: string; response: Response }

type CrawlContext = {
	resolve: Resolve
	fetchResource: FetchResource
	now: () => number
	limits: WebsiteCrawlerLimits
	deadline: number
	robots: RobotsRules
}

async function fetchOnce(url: URL, context: CrawlContext): Promise<Response> {
	const remaining = context.deadline - context.now()
	if (remaining <= 0) return unreachable()
	const address = await resolvePublicAddress(url, context.resolve)
	try {
		return await context.fetchResource(url, address, Math.min(context.limits.requestTimeoutMs, remaining))
	} catch (error) {
		if (error instanceof WebsiteCrawlError) throw error
		return unreachable()
	}
}

async function fetchFollowingRedirects(
	startUrl: string,
	context: CrawlContext,
	inScope: (url: URL) => boolean,
	checkRobots: boolean,
): Promise<FetchedResource> {
	let current = canonicalWebsiteUrl(startUrl)
	for (let redirect = 0; redirect <= context.limits.maxRedirects; redirect += 1) {
		const parsed = new URL(current)
		if (!inScope(parsed)) blocked()
		if (checkRobots && !context.robots.allows(parsed)) blocked()
		const response = await fetchOnce(parsed, context)
		if (!REDIRECT_STATUSES.has(response.status)) {
			if (!response.ok) {
				await response.body?.cancel().catch(() => undefined)
				return unreachable()
			}
			return { url: current, response }
		}
		const location = response.headers.get("location")
		await response.body?.cancel().catch(() => undefined)
		if (!location) unreachable()
		if (redirect === context.limits.maxRedirects) tooLarge()
		current = canonicalWebsiteUrl(location, parsed)
	}
	return unreachable()
}

async function readBounded(response: Response, maximum: number): Promise<Uint8Array> {
	const declared = Number(response.headers.get("content-length"))
	if (Number.isFinite(declared) && declared > maximum) {
		await response.body?.cancel().catch(() => undefined)
		return tooLarge()
	}
	const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined
	if (!reader) unreachable()
	const pieces: Uint8Array[] = []
	let total = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			total += value.byteLength
			if (total > maximum) {
				await reader.cancel()
				return tooLarge()
			}
			pieces.push(value)
		}
	} catch (error) {
		if (error instanceof WebsiteCrawlError) throw error
		return unreachable()
	}
	return Buffer.concat(pieces)
}

type RobotsRule = { path: string; allow: boolean }
type RobotsGroup = { agents: string[]; rules: RobotsRule[] }

class RobotsRules {
	private readonly groups: RobotsGroup[] = []

	addGroup(agents: string[]): RobotsGroup {
		const group: RobotsGroup = { agents, rules: [] }
		this.groups.push(group)
		return group
	}

	allows(url: URL): boolean {
		const matching = this.groups.filter((group) => group.agents.includes("talqo"))
		const groups = matching.length ? matching : this.groups.filter((group) => group.agents.includes("*"))
		const target = `${url.pathname}${url.search}`
		const rules = groups.flatMap((group) => group.rules).filter((rule) => pathMatches(rule.path, target))
		rules.sort((left, right) => right.path.length - left.path.length || Number(right.allow) - Number(left.allow))
		return rules[0]?.allow ?? true
	}
}

function pathMatches(rule: string, target: string): boolean {
	if (!rule) return true
	const anchored = rule.endsWith("$")
	const pattern = anchored ? rule.slice(0, -1) : rule
	const regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("\\*", ".*")}`)
	return anchored ? target.length === pattern.length && regex.test(target) : regex.test(target)
}

function parseRobots(text: string): RobotsRules {
	const robots = new RobotsRules()
	let current: RobotsGroup | undefined
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.split("#", 1)[0]?.trim()
		if (!line) continue
		const separator = line.indexOf(":")
		if (separator < 0) continue
		const field = line.slice(0, separator).trim().toLowerCase()
		const value = line.slice(separator + 1).trim()
		if (field === "user-agent") {
			if (!current || current.rules.length) current = robots.addGroup([])
			current.agents.push(value.toLowerCase())
		} else if ((field === "allow" || field === "disallow") && current) {
			current.rules.push({ path: value, allow: field === "allow" })
		}
	}
	return robots
}

async function loadRobots(origin: string, context: Omit<CrawlContext, "robots">): Promise<RobotsRules> {
	const response = await fetchOnce(new URL("/robots.txt", origin), {
		...context,
		robots: new RobotsRules(),
	})
	if (response.status === HTTP_STATUS.NOT_FOUND) return new RobotsRules()
	if (!response.ok) {
		await response.body?.cancel().catch(() => undefined)
		return unreachable()
	}
	const maximum = context.limits.maxHtmlBytes
	return parseRobots(new TextDecoder().decode(await readBounded(response, maximum)))
}

function htmlLinks(html: string): string[] {
	const document = parseDocument(html)
	return DomUtils.findAll((element) => element.name === "a" && Boolean(element.attribs.href), document.children).map(
		(element) => element.attribs.href ?? "",
	)
}

type SitemapDocument = { kind: "index" | "pages"; locations: string[] }

function sitemapLocations(value: unknown): string[] {
	if (value === undefined || value === "") return []
	const entries = Array.isArray(value) ? value : [value]
	return entries.map((entry) => {
		if (typeof entry !== "object" || entry === null || !("loc" in entry)) unreachable()
		const location = (entry as { loc?: unknown }).loc
		if (typeof location !== "string" && typeof location !== "number") unreachable()
		return String(location).trim()
	})
}

function parseSitemap(bytes: Uint8Array): SitemapDocument {
	const xml = new TextDecoder().decode(bytes)
	if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) unreachable()
	let parsed: unknown
	try {
		parsed = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true }).parse(xml)
	} catch {
		return unreachable()
	}
	if (typeof parsed !== "object" || parsed === null) unreachable()
	const document = parsed as Record<string, unknown>
	if ("urlset" in document) {
		const root = document.urlset
		const entries = typeof root === "object" && root !== null ? (root as Record<string, unknown>).url : undefined
		return { kind: "pages", locations: sitemapLocations(entries) }
	}
	if ("sitemapindex" in document) {
		const root = document.sitemapindex
		const entries = typeof root === "object" && root !== null ? (root as Record<string, unknown>).sitemap : undefined
		return { kind: "index", locations: sitemapLocations(entries) }
	}
	return unreachable()
}

function sameOrigin(url: URL, start: URL): boolean {
	return url.origin === start.origin
}

function canonicalDiscoveredLink(raw: string, base: string, start: URL, sitemap: boolean): string | undefined {
	let canonical: string
	try {
		canonical = canonicalWebsiteUrl(raw, new URL(base))
	} catch (error) {
		if (error instanceof WebsiteCrawlError && error.reason === "website-too-large") throw error
		return undefined
	}
	const url = new URL(canonical)
	if (!sameOrigin(url, start) || (!sitemap && !url.pathname.startsWith(start.pathname))) return undefined
	return canonical
}

function assertPageCapacity(count: number, queued: number, limits: WebsiteCrawlerLimits): void {
	if (count >= limits.maxPages && queued > 0) tooLarge()
	if (queued > limits.maxDiscoveredPages) tooLarge()
}

async function crawlSitemap(
	start: URL,
	initial: FetchedResource,
	context: CrawlContext,
): Promise<CrawledPage[]> {
	const visitedSitemaps = new Set<string>()
	const pageQueue: string[] = []
	const queuedPages = new Set<string>()
	const pages: CrawledPage[] = []
	const finalPages = new Set<string>()
	let totalHtmlBytes = 0

	async function collect(resource: FetchedResource, depth: number): Promise<void> {
		if (depth > context.limits.maxSitemapDepth || visitedSitemaps.size >= context.limits.maxSitemaps) tooLarge()
		visitedSitemaps.add(resource.url)
		if (!isSitemapLocation(new URL(resource.url), resource.response)) unreachable()
		const body = await readBounded(resource.response, context.limits.maxSitemapBytes)
		const sitemap = parseSitemap(body)
		if (sitemap.kind === "index") {
			for (const location of sitemap.locations) {
				const canonical = canonicalDiscoveredLink(location, resource.url, start, true)
				if (!canonical || visitedSitemaps.has(canonical)) continue
				const nested = await fetchFollowingRedirects(canonical, context, (url) => sameOrigin(url, start), true)
				if (visitedSitemaps.has(nested.url)) continue
				await collect(nested, depth + 1)
			}
			return
		}
		for (const location of sitemap.locations) {
			const canonical = canonicalDiscoveredLink(location, resource.url, start, true)
			if (!canonical || queuedPages.has(canonical) || !context.robots.allows(new URL(canonical))) continue
			queuedPages.add(canonical)
			pageQueue.push(canonical)
			assertPageCapacity(pageQueue.length > context.limits.maxPages ? context.limits.maxPages : 0, pageQueue.length, context.limits)
		}
	}

	await collect(initial, 0)
	for (let position = 0; position < pageQueue.length; position += 1) {
		assertPageCapacity(pages.length, pageQueue.length - position, context.limits)
		const candidate = pageQueue[position]
		if (!candidate) continue
		const resource = await fetchFollowingRedirects(candidate, context, (url) => sameOrigin(url, start), true)
		if (finalPages.has(resource.url)) {
			await resource.response.body?.cancel().catch(() => undefined)
			continue
		}
		if (!HTML_CONTENT_TYPES.has(mediaType(resource.response))) {
			await resource.response.body?.cancel().catch(() => undefined)
			return unreachable()
		}
		totalHtmlBytes += Number(resource.response.headers.get("content-length")) || 0
		if (totalHtmlBytes > context.limits.maxTotalHtmlBytes) {
			await resource.response.body?.cancel().catch(() => undefined)
			return tooLarge()
		}
		const html = await readBounded(resource.response, context.limits.maxHtmlBytes)
		totalHtmlBytes += html.byteLength - (Number(resource.response.headers.get("content-length")) || 0)
		if (totalHtmlBytes > context.limits.maxTotalHtmlBytes) tooLarge()
		finalPages.add(resource.url)
		pages.push({ url: resource.url, html })
	}
	return pages
}

async function crawlBreadthFirst(start: URL, initial: FetchedResource, context: CrawlContext): Promise<CrawledPage[]> {
	const queue = [initial.url]
	const queued = new Set(queue)
	const finalPages = new Set<string>()
	const pages: CrawledPage[] = []
	let totalHtmlBytes = 0

	for (let position = 0; position < queue.length; position += 1) {
		assertPageCapacity(pages.length, queue.length - position, context.limits)
		const candidate = queue[position]
		if (!candidate) continue
		const resource = position === 0 && candidate === initial.url
			? initial
			: await fetchFollowingRedirects(candidate, context, (url) => sameOrigin(url, start) && url.pathname.startsWith(start.pathname), true)
		if (finalPages.has(resource.url)) {
			await resource.response.body?.cancel().catch(() => undefined)
			continue
		}
		if (!HTML_CONTENT_TYPES.has(mediaType(resource.response))) {
			await resource.response.body?.cancel().catch(() => undefined)
			return unreachable()
		}
		totalHtmlBytes += Number(resource.response.headers.get("content-length")) || 0
		if (totalHtmlBytes > context.limits.maxTotalHtmlBytes) {
			await resource.response.body?.cancel().catch(() => undefined)
			return tooLarge()
		}
		const html = await readBounded(resource.response, context.limits.maxHtmlBytes)
		totalHtmlBytes += html.byteLength - (Number(resource.response.headers.get("content-length")) || 0)
		if (totalHtmlBytes > context.limits.maxTotalHtmlBytes) tooLarge()
		finalPages.add(resource.url)
		pages.push({ url: resource.url, html })
		for (const raw of htmlLinks(new TextDecoder().decode(html))) {
			const canonical = canonicalDiscoveredLink(raw, resource.url, start, false)
			if (!canonical || queued.has(canonical) || !context.robots.allows(new URL(canonical))) continue
			queued.add(canonical)
			queue.push(canonical)
			if (queue.length > context.limits.maxDiscoveredPages) tooLarge()
		}
	}
	return pages
}

export async function crawlWebsite(
	startUrl: string,
	dependencies: WebsiteCrawlerDependencies = {},
): Promise<CrawledPage[]> {
	const start = new URL(canonicalWebsiteUrl(startUrl))
	const limits = { ...DEFAULT_LIMITS, ...dependencies.limits }
	const now = dependencies.now ?? Date.now
	const context: Omit<CrawlContext, "robots"> = {
		resolve: dependencies.resolve ?? defaultResolve,
		fetchResource: dependencies.fetchResource ?? defaultFetchResource,
		now,
		limits,
		deadline: now() + limits.overallTimeoutMs,
	}
	const robots = await loadRobots(start.origin, context)
	const fullContext = { ...context, robots }
	const sitemap = isSitemapLocation(start)
	const initial = await fetchFollowingRedirects(
		start.href,
		fullContext,
		(url) => sameOrigin(url, start) && (sitemap || url.pathname.startsWith(start.pathname)),
		true,
	)
	return isSitemapLocation(new URL(initial.url), initial.response)
		? crawlSitemap(start, initial, fullContext)
		: crawlBreadthFirst(start, initial, fullContext)
}
