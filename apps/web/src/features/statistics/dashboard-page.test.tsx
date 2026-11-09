import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"

import type { DashboardSearch } from "./dashboard-page"
import type { StatsOverview } from "./page-stats"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { DashboardIndexPage } = await import("./dashboard-page")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act, useEffect, useState } = await import("react")
const { t } = await import("i18next")

const AGENTS = [
	{
		id: "agent-1",
		name: "Shop helper",
		createdAt: "2026-10-20T00:00:00.000Z",
		updatedAt: "2026-10-20T00:00:00.000Z",
		permissions: ["stats:read"],
	},
	{
		id: "agent-2",
		name: "Billing helper",
		createdAt: "2026-10-21T00:00:00.000Z",
		updatedAt: "2026-10-21T00:00:00.000Z",
		permissions: ["stats:read"],
	},
]

let requested: string[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let permissionResponse: () => Response
let agentsResponse: () => Response | Promise<Response>
let statsResponse: (days: string | null) => Response | Promise<Response>
let createBody: { name?: string; systemPrompt?: string; wordBlacklist?: string[] } | undefined
let createdAgent = false

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function emptyOverview(days: number): { overview: StatsOverview } {
	return {
		overview: {
			days,
			totals: { conversations: 0, messages: 0, inputTokens: 0, outputTokens: 0 },
			daily: [],
			agentDaily: [],
			agents: [],
			active: [],
			activeWindowMinutes: 5,
		},
	}
}

function usageOverview(days: number): { overview: StatsOverview } {
	return {
		overview: {
			days,
			totals: { conversations: 7, messages: 17, inputTokens: 30, outputTokens: 18 },
			daily: [
				{ date: "2026-11-01", conversations: 3, messages: 7, inputTokens: 11, outputTokens: 7 },
				{ date: "2026-11-02", conversations: 4, messages: 10, inputTokens: 20, outputTokens: 10 },
			],
			agentDaily: [
				{
					agentId: "agent-1",
					date: "2026-11-01",
					conversations: 2,
					messages: 4,
					inputTokens: 10,
					outputTokens: 5,
				},
				{
					agentId: "agent-2",
					date: "2026-11-01",
					conversations: 1,
					messages: 3,
					inputTokens: 1,
					outputTokens: 2,
				},
				{
					agentId: "agent-2",
					date: "2026-11-02",
					conversations: 4,
					messages: 10,
					inputTokens: 20,
					outputTokens: 10,
				},
			],
			agents: [
				{
					agentId: "agent-2",
					agentName: "Billing helper",
					conversations: 4,
					messages: 10,
					inputTokens: 20,
					outputTokens: 10,
				},
				{
					agentId: "agent-1",
					agentName: "Shop helper",
					conversations: 3,
					messages: 7,
					inputTokens: 11,
					outputTokens: 7,
				},
			],
			active: [
				{ agentId: "agent-1", conversations: 2 },
				{ agentId: "agent-2", conversations: 1 },
			],
			activeWindowMinutes: 5,
		},
	}
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function Harness({
	initial,
	openAgent,
	onSearchChange,
}: {
	initial: DashboardSearch
	openAgent?: (agentId: string) => void
	onSearchChange?: (search: DashboardSearch) => void
}) {
	const [search, setSearch] = useState<DashboardSearch>(initial)
	useEffect(() => {
		onSearchChange?.(search)
	}, [onSearchChange, search])
	return <DashboardIndexPage openAgent={openAgent} search={search} onSearchChange={setSearch} />
}

async function renderPage(
	initial: DashboardSearch,
	openAgent?: (agentId: string) => void,
	onSearchChange?: (search: DashboardSearch) => void,
) {
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<Harness initial={initial} openAgent={openAgent} onSearchChange={onSearchChange} />
				</LanguageProvider>
			</QueryClientProvider>,
		),
	)
	await settle()
	await settle()
}

function combobox(label: string): HTMLElement {
	const element = host.querySelector<HTMLElement>(`[role=combobox][aria-label="${label}"]`)
	if (!element) throw new Error(`${label} combobox not rendered`)
	return element
}

async function choose(label: string, option: string) {
	await click(combobox(label))
	const popup = [...document.querySelectorAll("[data-slot=select-content]")].at(-1) ?? document
	const item = [...popup.querySelectorAll<HTMLElement>("[role=option]")].find(
		(element) => element.textContent?.trim() === option,
	)
	if (!item) throw new Error(`${option} option not rendered`)
	await click(item)
}

async function click(element: HTMLElement) {
	await act(async () => element.click())
	await settle()
}

function button(label: string, parent: ParentNode = document): HTMLButtonElement {
	const found = [...parent.querySelectorAll("button")].find((element) => element.textContent?.trim() === label)
	if (!found) throw new Error(`${label} button not rendered`)
	return found
}

function cardValue(label: string): string | undefined {
	const description = [...host.querySelectorAll("[data-slot=card-description]")].find(
		(element) => element.textContent === label,
	)
	return description?.parentElement?.querySelector("p")?.textContent ?? undefined
}

function breakdownRows(): string[][] {
	return [...host.querySelectorAll("tbody tr")].map((row) =>
		[...row.querySelectorAll("th, td")].map((cell) => cell.textContent ?? ""),
	)
}

beforeEach(() => {
	requested = []
	createBody = undefined
	createdAgent = false
	permissionResponse = () => json({ permissions: ["admin"] })
	agentsResponse = () => json({ agents: AGENTS })
	statsResponse = (days) => json(emptyOverview(days === "all" ? 0 : Number(days)))
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		requested.push(url)
		if (url === "/api/me/permissions") return permissionResponse()
		if (url === "/api/agents" && init?.method === "POST") {
			createBody = JSON.parse(typeof init.body === "string" ? init.body : "{}") as typeof createBody
			createdAgent = true
			return json({
				agent: {
					id: AGENTS[0]?.id,
					name: AGENTS[0]?.name,
					systemPrompt: "prompt",
					wordBlacklist: [],
					createdAt: "2026-10-20T00:00:00.000Z",
					updatedAt: "2026-10-20T00:00:00.000Z",
				},
			})
		}
		if (url === "/api/agents") return createdAgent ? json({ agents: [AGENTS[0]] }) : agentsResponse()
		if (url.startsWith("/api/stats")) return statsResponse(new URL(url, "http://localhost").searchParams.get("days"))
		throw new Error(`unexpected request ${url}`)
	}) as typeof fetch)
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	queryClient.clear()
	mock.restore()
})

test("keeps both filters visible and offers all time when a range has no conversations", async () => {
	await renderPage({ days: 7 })

	expect(host.textContent).toContain(t("dashboard.emptyRange", { range: t("dashboard.range7d") }))
	expect(host.textContent).toContain(t("dashboard.agentsLabel"))
	expect(host.textContent).toContain(t("dashboard.rangeLabel"))
	expect(requested).toContain("/api/stats?days=7")

	const allTime = host.querySelector<HTMLButtonElement>('[data-slot="empty-state"] button')
	if (!allTime) throw new Error("all time action not rendered")
	expect(allTime.textContent?.trim()).toBe(t("dashboard.rangeAll"))
	await act(async () => allTime.click())
	await settle()
	await settle()

	expect(requested).toContain("/api/stats?days=all")
	expect(host.textContent).toContain(t("dashboard.emptyAll"))
	expect(host.textContent).toContain(t("dashboard.agentsLabel"))
	expect(host.textContent).toContain(t("dashboard.rangeLabel"))
	expect(host.querySelectorAll('[data-slot="empty-state"] button')).toHaveLength(0)
})

test("summarizes usage and lists per-agent totals for selected agents in name order", async () => {
	statsResponse = (days) => json(usageOverview(days === "all" ? 0 : Number(days)))
	await renderPage({})

	expect(host.textContent).toContain(t("dashboard.usageOverTime"))
	expect(cardValue(t("dashboard.conversations"))).toBe("7")
	expect(cardValue(t("dashboard.messages"))).toBe("17")
	expect(cardValue(t("dashboard.activeConversations", { minutes: 5 }))).toBeUndefined()
	expect(cardValue(t("dashboard.recentMinutes", { metric: t("dashboard.activeConversations"), minutes: 5 }))).toBe("3")
	expect(cardValue(t("dashboard.tokens"))).toBe("48")
	expect(cardValue(t("dashboard.messagesPerConversation"))).toBe("2.4")
	expect(cardValue(t("dashboard.tokensPerConversation"))).toBe("6.9")
	expect(breakdownRows()).toEqual([
		["Billing helper", "4", "10", "30"],
		["Shop helper", "3", "7", "18"],
	])
	expect(host.textContent).toContain(t("dashboard.agentsSelected", { selected: 2, total: 2, count: 2 }))
	expect(host.querySelector("table caption")?.textContent).toBe(t("dashboard.perAgentCaption"))
	expect([...host.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual([
		t("dashboard.agentColumn"),
		t("dashboard.conversations"),
		t("dashboard.messages"),
		t("dashboard.tokens"),
	])
	expect(host.textContent).toContain(t("dashboard.total"))
})

test("filters the summary to the chosen agents and restores all agents", async () => {
	statsResponse = (days) => json(usageOverview(days === "all" ? 0 : Number(days)))
	const searches: DashboardSearch[] = []
	await renderPage({}, undefined, (search) => searches.push(search))

	await click(combobox(t("dashboard.agentsLabel")))
	expect(button(t("dashboard.selectAll")).disabled).toBe(true)
	expect(button(t("dashboard.deselectAll")).disabled).toBe(false)

	const shop = [...document.querySelectorAll<HTMLElement>("[role=option]")].find(
		(element) => element.textContent?.trim() === "Shop helper",
	)
	if (!shop) throw new Error("Shop helper option not rendered")
	await click(shop)

	expect(breakdownRows()).toEqual([["Billing helper", "4", "10", "30"]])
	expect(searches.at(-1)?.agents).toEqual(["agent-2"])
	expect(host.textContent).toContain(t("dashboard.agentsSelected", { selected: 1, total: 2, count: 2 }))

	if (document.querySelector("[role=listbox]") === null) await click(combobox(t("dashboard.agentsLabel")))
	await click(button(t("dashboard.selectAll")))

	expect(breakdownRows()).toHaveLength(2)
	expect(searches.at(-1)?.agents).toBeUndefined()
	expect(host.textContent).toContain(t("dashboard.agentsSelected", { selected: 2, total: 2, count: 2 }))

	if (document.querySelector("[role=listbox]") === null) await click(combobox(t("dashboard.agentsLabel")))
	await click(button(t("dashboard.deselectAll")))

	expect(searches.at(-1)?.agents).toEqual([])
	expect(host.textContent).toContain(t("dashboard.noAgentsSelected"))
	expect(host.querySelector("tbody") === null).toBe(true)
})

test("shows zero averages for a selected agent without activity", async () => {
	statsResponse = (days) => {
		const response = usageOverview(days === "all" ? 0 : Number(days))
		response.overview.agentDaily = response.overview.agentDaily.filter((point) => point.agentId === "agent-1")
		response.overview.agents = response.overview.agents.filter((row) => row.agentId === "agent-1")
		response.overview.active = response.overview.active.filter((row) => row.agentId === "agent-1")
		return json(response)
	}
	await renderPage({})

	await click(combobox(t("dashboard.agentsLabel")))
	const shop = [...document.querySelectorAll<HTMLElement>("[role=option]")].find(
		(element) => element.textContent?.trim() === "Shop helper",
	)
	if (!shop) throw new Error("Shop helper option not rendered")
	await click(shop)

	expect(host.textContent).not.toContain(t("dashboard.emptyTitle"))
	expect(cardValue(t("dashboard.conversations"))).toBe("0")
	expect(cardValue(t("dashboard.messages"))).toBe("0")
	expect(cardValue(t("dashboard.tokens"))).toBe("0")
	expect(cardValue(t("dashboard.messagesPerConversation"))).toBe("0")
	expect(cardValue(t("dashboard.tokensPerConversation"))).toBe("0")
})

test("requests the selected time range and omits the default", async () => {
	statsResponse = (days) => json(usageOverview(days === "all" ? 0 : Number(days)))
	const searches: DashboardSearch[] = []
	await renderPage({ days: 7 }, undefined, (search) => searches.push(search))

	await choose(t("dashboard.rangeLabel"), t("dashboard.range30d"))
	expect(searches.at(-1)?.days).toBeUndefined()
	expect(requested).toContain("/api/stats?days=30")

	await choose(t("dashboard.rangeLabel"), t("dashboard.rangeAll"))
	expect(searches.at(-1)?.days).toBe("all")
	expect(requested).toContain("/api/stats?days=all")

	await choose(t("dashboard.rangeLabel"), t("dashboard.range30d"))
	expect(requested.filter((url) => url === "/api/stats?days=30").length).toBe(2)
})

test("shows the loading skeleton until both queries resolve", async () => {
	const stats = Promise.withResolvers<Response>()
	statsResponse = () => stats.promise
	await renderPage({})

	expect(host.querySelector("output")?.textContent).toBe(t("dashboard.loading"))

	await act(async () => stats.resolve(json(emptyOverview(30))))
	await settle()
	await settle()

	expect(host.textContent).not.toContain(t("dashboard.loading"))
})

test("denies statistics access when either query is forbidden", async () => {
	statsResponse = () => json({}, 403)
	await renderPage({})
	expect(host.textContent).toContain(t("permissions.accessDeniedTitle"))

	await act(async () => root.render(null))
	statsResponse = (days) => json(usageOverview(days === "all" ? 0 : Number(days)))
	agentsResponse = () => json({}, 403)
	await renderPage({})
	expect(host.textContent).toContain(t("permissions.accessDeniedTitle"))
})

test("shows a retryable load error when statistics cannot be loaded", async () => {
	statsResponse = () => json({ code: "invalid-request", type: "https://docs.talqo.chat/problems#invalid-request" }, 400)
	await renderPage({})

	expect(host.textContent).toContain(t("problems.invalid-request"))
	const before = requested.length
	await click(button(t("common.retry")))
	expect(requested.length).toBeGreaterThan(before)
})

test("invites the operator to create the first agent and opens it", async () => {
	agentsResponse = () => json({ agents: [] })
	const opened: string[] = []
	await renderPage({}, (agentId) => opened.push(agentId))

	expect(host.textContent).toContain(t("dashboard.noAgentsTitle"))
	await click(button(t("agents.create")))

	expect(createBody).toEqual({
		name: t("agents.defaultName"),
		systemPrompt: t("agents.defaultSystemPrompt"),
		wordBlacklist: [],
	})
	expect(opened[0]).toBe(AGENTS[0]?.id)
	expect(requested.filter((url) => url === "/api/agents").length).toBeGreaterThanOrEqual(2)
})
