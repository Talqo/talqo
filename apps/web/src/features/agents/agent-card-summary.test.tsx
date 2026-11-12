import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { AgentCardSummary } = await import("./agent-card-summary")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const FILES_URL = "/api/agents/agent-1/files"
const SERVERS_URL = "/api/agents/agent-1/mcp-servers"
const EMBEDS_URL = "/api/embeds?agentId=agent-1"

const FILES = [
	{
		name: "faq.md",
		sizeBytes: 10,
		createdAt: "2026-01-01T00:00:00Z",
		embeddingStatus: "ready",
		embeddingError: null,
	},
	{
		name: "shipping.md",
		sizeBytes: 20,
		createdAt: "2026-01-01T00:00:00Z",
		embeddingStatus: "ready",
		embeddingError: null,
	},
]

const SERVER = {
	id: "stock",
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
	revision: 1,
}

const EMBED = {
	id: "embed",
	agentId: "agent-1",
	name: "Site",
	embedToken: "token",
	accessVersion: 1,
	isDisabled: false,
	appearance: {
		light: { primary: "#000000", textOnPrimary: "#ffffff", background: "#ffffff", surface: "#ffffff", text: "#000000" },
		dark: { primary: "#ffffff", textOnPrimary: "#000000", background: "#000000", surface: "#000000", text: "#ffffff" },
		position: "bottom-right",
		theme: "system",
		themeToggle: false,
		language: "en",
	},
}

let host: HTMLDivElement
let root: Root
let client: InstanceType<typeof QueryClient>
let failures: Record<string, Response | undefined>
let pending: Record<string, Promise<Response> | undefined>

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

function responseFor(url: string): Response {
	const failure = failures[url]
	if (failure) return failure
	if (url === FILES_URL)
		return json({ files: FILES, maxSizeBytes: 1024, maxNameLength: 64, allowedExtensions: [".md"] })
	if (url === SERVERS_URL)
		return json({
			stdioAllowed: true,
			servers: [
				{
					...SERVER,
					tools: [
						{ name: "price", description: "", enabled: true },
						{ name: "history", description: "", enabled: false },
					],
					toolCount: 2,
				},
				{
					...SERVER,
					id: "warehouse",
					name: "Warehouse",
					isDisabled: true,
					tools: [{ name: "stock", description: "", enabled: true }],
					toolCount: 1,
				},
			],
		})
	if (url === EMBEDS_URL) return json({ embeds: [EMBED, { ...EMBED, id: "second", isDisabled: true }] })
	throw new Error(`unexpected request ${url}`)
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderSummary() {
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<AgentCardSummary agentId="agent-1" />
			</QueryClientProvider>,
		),
	)
	await settle()
}

function metric(label: string): string {
	const found = [...host.querySelectorAll("span")].find((element) => element.textContent?.startsWith(label))
	if (!found) throw new Error(`metric ${label} not rendered`)
	return found.textContent ?? ""
}

beforeEach(() => {
	failures = {}
	pending = {}
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		const waiting = pending[url]
		if (waiting) return waiting
		return responseFor(url)
	}) as typeof fetch)
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	client.clear()
	mock.restore()
})

describe("AgentCardSummary", () => {
	test("summarizes files, enabled tools on enabled connections, and enabled embeds", async () => {
		await renderSummary()

		expect(metric(t("agents.metricFiles"))).toBe(`${t("agents.metricFiles")}: 2`)
		expect(metric(t("agents.metricTools"))).toBe(`${t("agents.metricTools")}: 1`)
		expect(metric(t("agents.metricEnabledEmbeds"))).toBe(`${t("agents.metricEnabledEmbeds")}: 1`)
		expect(host.querySelector('[role="alert"]') === null).toBe(true)
	})

	test("shows a placeholder while each source is loading", async () => {
		const files = Promise.withResolvers<Response>()
		const servers = Promise.withResolvers<Response>()
		const embeds = Promise.withResolvers<Response>()
		pending = { [FILES_URL]: files.promise, [SERVERS_URL]: servers.promise, [EMBEDS_URL]: embeds.promise }

		await renderSummary()

		expect(metric(t("agents.metricFiles"))).toBe(`${t("agents.metricFiles")}: …`)
		expect(metric(t("agents.metricTools"))).toBe(`${t("agents.metricTools")}: …`)
		expect(metric(t("agents.metricEnabledEmbeds"))).toBe(`${t("agents.metricEnabledEmbeds")}: …`)
		expect(host.querySelector('[role="alert"]') === null).toBe(true)

		await act(async () => {
			files.resolve(responseFor(FILES_URL))
			servers.resolve(responseFor(SERVERS_URL))
			embeds.resolve(responseFor(EMBEDS_URL))
		})
		await settle()
		expect(metric(t("agents.metricFiles"))).toBe(`${t("agents.metricFiles")}: 2`)
	})

	const metrics = [
		["files", FILES_URL, t("agents.metricFiles"), "2"],
		["connections", SERVERS_URL, t("agents.metricTools"), "1"],
		["embeds", EMBEDS_URL, t("agents.metricEnabledEmbeds"), "1"],
	] as const

	for (const [source, url, label] of metrics) {
		test(`marks only the failed ${source} metric unavailable and alerts once`, async () => {
			failures[url] = new Response(JSON.stringify({ code: "internal-server-error" }), {
				status: 500,
				headers: { "content-type": "application/json" },
			})

			await renderSummary()

			expect(metric(label)).toBe(`${label}: ${t("agents.metricUnavailable")}`)
			for (const [otherSource, , otherLabel, otherValue] of metrics) {
				if (otherSource !== source) expect(metric(otherLabel)).toBe(`${otherLabel}: ${otherValue}`)
			}
			expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
			expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("agents.summaryLoadFailed"))
		})
	}
})
