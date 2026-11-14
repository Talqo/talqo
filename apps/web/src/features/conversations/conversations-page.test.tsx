import type { QueryClient } from "@/testing/component-harness"

import { json } from "@/testing/api-responses"
import { act, createTestHarness, type Root, settle } from "@/testing/component-harness"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import type { ConversationsSearch as Search } from "./conversations-search"

import { renderConversationsPage } from "./-render-with-providers"

const { ConversationsPage } = await import("./conversations-page")
const { createMemoryHistory, createRootRoute, createRouter } = await import("@tanstack/react-router")
const { useState } = await import("react")
const { t } = await import("i18next")

const SHOP = { id: "11111111-1111-4111-8111-111111111111", name: "Shop helper", permissions: ["conversations:read"] }
const DOCS = { id: "22222222-2222-4222-8222-222222222222", name: "Docs helper", permissions: ["conversations:read"] }
const HIDDEN = { id: "33333333-3333-4333-8333-333333333333", name: "Hidden helper", permissions: [] }
const REMOVED_ID = "44444444-4444-4444-8444-444444444444"

function summary(id: string, startedAt: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		agentId: SHOP.id,
		startedAt,
		messageCount: 2,
		preview: `Question ${id}`,
		...overrides,
	}
}

function list(conversations: unknown[], total = conversations.length, page = 1) {
	return json({ conversations, page, pageSize: 25, total })
}

let responses: Record<string, () => Response | Promise<Response>>
let requested: string[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let harness: ReturnType<typeof createTestHarness>

function Harness({ initial }: { initial: Search }) {
	const [search, setSearch] = useState(initial)
	return <ConversationsPage search={search} onSearchChange={setSearch} />
}

async function renderPage(initial: Search = {}) {
	const rootRoute = createRootRoute({ component: () => <Harness initial={initial} /> })
	const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory() })
	await renderConversationsPage(root, queryClient, router)
	await settle()
	await settle()
}

function button(label: string, scope: ParentNode = host): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find((element) => element.textContent === label)
	if (!found) throw new Error(`button ${label} not rendered`)
	return found
}

function combobox(label: string): HTMLElement {
	const element = host.querySelector<HTMLElement>(`[role=combobox][aria-label="${label}"]`)
	if (!element) throw new Error(`${label} combobox not rendered`)
	return element
}

async function click(element: HTMLElement) {
	await act(async () => element.click())
	await settle()
}

beforeEach(() => {
	requested = []
	responses = { "/api/agents": () => json({ agents: [SHOP, DOCS] }) }
	harness = createTestHarness({
		fetch: (async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
			requested.push(url)
			const respond = responses[url]
			if (!respond) throw new Error(`unexpected request ${url}`)
			return respond()
		}) as typeof fetch,
	})
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

describe("ConversationsPage", () => {
	test("explains where conversations come from when there are none", async () => {
		responses["/api/conversations?page=1"] = () => list([])

		await renderPage()

		expect(host.textContent).toContain(t("conversations.emptyTitle"))
		expect(host.textContent).toContain(t("conversations.emptyDescription"))
		expect(host.querySelector(`nav[aria-label="${t("conversations.pagination")}"]`)).toBeNull()
	})

	test("explains an empty filtered list without dropping the agent filter", async () => {
		responses[`/api/conversations?agentId=${DOCS.id}&page=1`] = () => list([])

		await renderPage({ agents: [DOCS.id] })

		expect(host.textContent).toContain(t("conversations.emptyFilteredTitle"))
		expect(host.textContent).toContain(t("conversations.emptyFilteredDescription"))
		expect(host.textContent).toContain(t("dashboard.agentsLabel"))
	})

	test("groups conversations by day and shows their agent", async () => {
		responses["/api/conversations?page=1"] = () =>
			list([
				summary("a", "2026-10-02T10:00:00.000Z"),
				summary("c", "2026-10-02T09:00:00.000Z"),
				summary("b", "2026-10-01T10:00:00.000Z", { agentId: DOCS.id, messageCount: 1 }),
			])

		await renderPage()

		expect([...host.querySelectorAll("h3")].map((heading) => heading.textContent)).toHaveLength(2)
		const rows = [...host.querySelectorAll("li")]
		expect(rows).toHaveLength(3)
		expect(rows[0]?.textContent).toContain(SHOP.name)
		expect(rows[1]?.textContent).toContain("Question c")
		expect(rows[2]?.textContent).toContain(DOCS.name)
		expect(rows[2]?.textContent).toContain(t("conversations.messageCount", { count: 1 }))
		expect(host.querySelector("a")?.getAttribute("href")).toBe("/dashboard/conversations/a")
	})

	test("pages through conversations and keeps the filters in each transcript link", async () => {
		const first = Array.from({ length: 25 }, (_, index) => summary(`p1-${index}`, "2026-10-02T10:00:00.000Z"))
		responses[`/api/conversations?agentId=${SHOP.id}&page=1`] = () => list(first, 30)
		responses[`/api/conversations?agentId=${SHOP.id}&page=2`] = () =>
			list([summary("p2-0", "2026-10-01T10:00:00.000Z")], 30, 2)

		await renderPage({ agents: [SHOP.id] })
		expect(host.textContent).toContain(t("conversations.pageOf", { page: 1, pages: 2 }))
		expect(button(t("conversations.previousPage")).disabled).toBe(true)
		expect(host.querySelector("section h2")?.getAttribute("tabindex")).toBe("-1")

		await act(async () => button(t("conversations.nextPage")).click())
		await settle()

		expect(host.textContent).toContain(t("conversations.pageOf", { page: 2, pages: 2 }))
		expect(host.querySelectorAll("li")).toHaveLength(1)
		expect(button(t("conversations.nextPage")).disabled).toBe(true)
		expect(document.activeElement?.tagName).toBe("H2")
		expect(host.querySelector("a")?.getAttribute("href")).toBe(
			`/dashboard/conversations/p2-0?agents=${encodeURIComponent(JSON.stringify([SHOP.id]))}&page=2`,
		)

		await act(async () => button(t("conversations.previousPage")).click())
		await settle()

		expect(requested).toContain(`/api/conversations?agentId=${SHOP.id}&page=1`)
		expect(host.textContent).toContain(t("conversations.pageOf", { page: 1, pages: 2 }))
		expect(button(t("conversations.previousPage")).disabled).toBe(true)
		expect(host.querySelector("a")?.getAttribute("href")).toBe(
			`/dashboard/conversations/p1-0?agents=${encodeURIComponent(JSON.stringify([SHOP.id]))}`,
		)
	})

	test("recovers from an out-of-range page through the first page", async () => {
		responses["/api/conversations?page=3"] = () => list([], 30, 3)
		responses["/api/conversations?page=1"] = () => list([summary("a", "2026-10-02T10:00:00.000Z")], 30)

		await renderPage({ page: 3 })

		expect(host.textContent).toContain(t("conversations.pageEmptyTitle"))
		expect(host.textContent).toContain(t("conversations.pageEmptyDescription"))

		await act(async () => button(t("conversations.firstPage")).click())
		await settle()

		expect(requested).toContain("/api/conversations?page=1")
		expect(host.textContent).toContain("Question a")
		expect(host.textContent).toContain(t("conversations.pageOf", { page: 1, pages: 2 }))
	})

	test("labels a missing preview and a removed agent", async () => {
		responses["/api/conversations?page=1"] = () =>
			list([summary("a", "2026-10-02T10:00:00.000Z", { agentId: REMOVED_ID, preview: null })])

		await renderPage()

		expect(host.textContent).toContain(t("conversations.noPreview"))
		expect(host.textContent).toContain(t("conversations.unknownAgent"))
	})

	test("shows every agent without a filter and hides them all from the selector", async () => {
		responses["/api/conversations?page=1"] = () => list([summary("a", "2026-10-02T10:00:00.000Z")])
		await renderPage({ agents: [SHOP.id] })

		await click(combobox(t("dashboard.agentsLabel")))
		await click(button(t("dashboard.selectAll"), document))
		await settle()

		expect(requested).toContain("/api/conversations?page=1")
		expect(host.querySelector("a")?.getAttribute("href")).toBe("/dashboard/conversations/a")

		if (document.querySelector("[role=listbox]") === null) await click(combobox(t("dashboard.agentsLabel")))
		await click(button(t("dashboard.deselectAll"), document))
		await settle()

		expect(host.querySelector("output")?.textContent).toBe(t("conversations.noAgentSelected"))
	})

	test("asks for an agent instead of loading when every agent is deselected", async () => {
		await renderPage({ agents: [] })

		expect(host.querySelector("output")?.textContent).toBe(t("conversations.noAgentSelected"))
		expect(requested.some((url) => url.startsWith("/api/conversations"))).toBe(false)
	})

	test("keeps only agents the operator can still read when the URL names others", async () => {
		responses["/api/agents"] = () => json({ agents: [SHOP, DOCS, HIDDEN] })
		responses[`/api/conversations?agentId=${DOCS.id}&page=1`] = () =>
			list([summary("a", "2026-10-02T10:00:00.000Z", { agentId: DOCS.id })])

		await renderPage({ agents: [HIDDEN.id, DOCS.id] })
		await settle()

		expect(requested).toContain(`/api/conversations?agentId=${DOCS.id}&page=1`)
		expect(requested.some((url) => url.includes(HIDDEN.id))).toBe(false)
		expect(host.querySelector("a")?.getAttribute("href")).toBe(
			`/dashboard/conversations/a?agents=${encodeURIComponent(JSON.stringify([DOCS.id]))}`,
		)
		expect(host.textContent).toContain(t("dashboard.agentsSelected", { selected: 1, total: 2, count: 2 }))
	})

	test("falls back to all agents when the URL names only removed ones", async () => {
		responses["/api/conversations?page=1"] = () => list([summary("a", "2026-10-02T10:00:00.000Z")])

		await renderPage({ agents: [REMOVED_ID] })
		await settle()

		expect(requested).toContain("/api/conversations?page=1")
		expect(requested.some((url) => url.includes(REMOVED_ID))).toBe(false)
		expect(host.querySelector("a")?.getAttribute("href")).toBe("/dashboard/conversations/a")
		expect(host.textContent).toContain(t("dashboard.agentsSelected", { selected: 2, total: 2, count: 2 }))
	})

	test("waits for agent discovery before requesting a filtered conversation list", async () => {
		const agents = Promise.withResolvers<Response>()
		responses["/api/agents"] = () => agents.promise
		responses[`/api/conversations?agentId=${DOCS.id}&page=1`] = () => list([])

		await renderPage({ agents: [DOCS.id] })
		expect(requested.some((url) => url.startsWith("/api/conversations"))).toBe(false)

		await act(async () => agents.resolve(json({ agents: [SHOP, DOCS] })))
		await settle()
		await settle()

		expect(requested).toContain(`/api/conversations?agentId=${DOCS.id}&page=1`)
	})

	test("starts the unfiltered list while agent discovery is still running", async () => {
		const agents = Promise.withResolvers<Response>()
		responses["/api/agents"] = () => agents.promise
		responses["/api/conversations?page=1"] = () => list([summary("a", "2026-10-02T10:00:00.000Z")])

		await renderPage()
		expect(requested).toContain("/api/conversations?page=1")

		await act(async () => agents.resolve(json({ agents: [SHOP, DOCS] })))
		await settle()
	})

	test("announces loading while conversations are pending", async () => {
		const conversations = Promise.withResolvers<Response>()
		responses["/api/conversations?page=1"] = () => conversations.promise

		await renderPage()
		expect(host.querySelector("output")?.textContent).toBe(t("conversations.loading"))

		await act(async () => conversations.resolve(list([summary("a", "2026-10-02T10:00:00.000Z")])))
		await settle()
		expect(host.textContent).toContain("Question a")
	})

	test("keeps a saved filter when the agent list cannot be loaded", async () => {
		responses["/api/agents"] = () =>
			json({ code: "internal-server-error", type: "https://docs.talqo.chat/problems#internal-server-error" }, 500)
		responses[`/api/conversations?agentId=${DOCS.id}&page=1`] = () => list([])

		await renderPage({ agents: [DOCS.id] })
		await settle()

		expect(requested).toContain(`/api/conversations?agentId=${DOCS.id}&page=1`)
		expect(requested).not.toContain("/api/conversations?page=1")
	})

	test("loads the first page when the URL filter is reconciled", async () => {
		responses["/api/conversations?page=1"] = () => list([summary("a", "2026-10-02T10:00:00.000Z")])

		await renderPage({ agents: [REMOVED_ID], page: 2 })
		await settle()

		expect(requested).toContain("/api/conversations?page=1")
		expect(requested.some((url) => url.includes("page=2"))).toBe(false)
	})

	test("offers a retry when loading fails", async () => {
		let attempts = 0
		responses[`/api/conversations?agentId=${DOCS.id}&page=1`] = () => {
			attempts += 1
			return attempts === 1
				? json({ code: "internal-server-error", type: "https://docs.talqo.chat/problems#internal-server-error" }, 500)
				: list([summary("a", "2026-10-02T10:00:00.000Z", { agentId: DOCS.id })])
		}

		await renderPage({ agents: [DOCS.id] })
		expect(host.querySelector("[role=alert] p")?.textContent).toBe(t("problems.internal-server-error"))

		await act(async () => button(t("common.retry")).click())
		await settle()

		expect(host.textContent).toContain("Question a")
	})
})
