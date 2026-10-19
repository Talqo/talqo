import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import type { ConversationsSearch as Search } from "./conversations-search"

// Component test files share one process, so only the first one registers the DOM.
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ConversationsPage } = await import("./conversations-page")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } = await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act, useState } = await import("react")
const { t } = await import("i18next")

const SHOP = { id: "11111111-1111-4111-8111-111111111111", name: "Shop helper" }
const DOCS = { id: "22222222-2222-4222-8222-222222222222", name: "Docs helper" }

function summary(id: string, startedAt: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		agentId: SHOP.id,
		startedAt,
		messageCount: 2,
		preview: `Question ${id}`,
		needsAttention: false,
		...overrides,
	}
}

function list(conversations: unknown[], total = conversations.length, page = 1) {
	return json({ conversations, page, pageSize: 25, total })
}

let responses: Record<string, () => Response>
let requested: string[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function Harness({ initial }: { initial: Search }) {
	const [search, setSearch] = useState(initial)
	return <ConversationsPage search={search} onSearchChange={setSearch} />
}

async function renderPage(initial: Search = {}) {
	const rootRoute = createRootRoute({ component: () => <Harness initial={initial} /> })
	const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory() })
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<RouterProvider router={router} />
				</LanguageProvider>
			</QueryClientProvider>,
		),
	)
	await settle()
	await settle()
}

function button(label: string): HTMLButtonElement {
	const found = [...host.querySelectorAll("button")].find((element) => element.textContent === label)
	if (!found) throw new Error(`button ${label} not rendered`)
	return found
}

beforeEach(() => {
	requested = []
	responses = { "/api/agents": () => json({ agents: [SHOP, DOCS] }) }
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		requested.push(url)
		const respond = responses[url]
		if (!respond) throw new Error(`unexpected request ${url}`)
		return respond()
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

describe("ConversationsPage", () => {
	test("explains where conversations come from when there are none", async () => {
		responses["/api/conversations?page=1"] = () => list([])

		await renderPage()

		expect(host.querySelector("[role=status]")?.textContent).toBe(t("conversations.empty"))
	})

	test("groups conversations by day and shows their agent and whether they need attention", async () => {
		responses["/api/conversations?page=1"] = () =>
			list([
				summary("a", "2026-10-02T10:00:00.000Z", { needsAttention: true }),
				summary("b", "2026-10-01T10:00:00.000Z", { agentId: DOCS.id, messageCount: 1 }),
			])

		await renderPage()

		expect([...host.querySelectorAll("h3")].map((heading) => heading.textContent)).toHaveLength(2)
		const rows = [...host.querySelectorAll("li")]
		expect(rows[0]?.textContent).toContain(SHOP.name)
		expect(rows[0]?.textContent).toContain(t("conversations.needsAttention"))
		expect(rows[1]?.textContent).toContain(DOCS.name)
		expect(rows[1]?.textContent).toContain(t("conversations.messageCount", { count: 1 }))
		expect(rows[1]?.textContent).not.toContain(t("conversations.needsAttention"))
		expect(host.querySelector("a")?.getAttribute("href")).toBe("/dashboard/conversations/a")
	})

	test("pages through conversations and keeps the filters in each transcript link", async () => {
		const first = Array.from({ length: 25 }, (_, index) => summary(`p1-${index}`, "2026-10-02T10:00:00.000Z"))
		responses["/api/conversations?needsAttention=true&page=1"] = () => list(first, 30)
		responses["/api/conversations?needsAttention=true&page=2"] = () =>
			list([summary("p2-0", "2026-10-01T10:00:00.000Z")], 30, 2)

		await renderPage({ attention: true })
		expect(host.textContent).toContain(t("conversations.pageOf", { page: 1, pages: 2 }))
		expect(button(t("conversations.previousPage")).disabled).toBe(true)

		await act(async () => button(t("conversations.nextPage")).click())
		await settle()

		expect(host.textContent).toContain(t("conversations.pageOf", { page: 2, pages: 2 }))
		expect(host.querySelectorAll("li")).toHaveLength(1)
		expect(document.activeElement?.tagName).toBe("H2")
		expect(host.querySelector("a")?.getAttribute("href")).toBe("/dashboard/conversations/p2-0?attention=true&page=2")
	})

	test("asks for an agent instead of loading when every agent is deselected", async () => {
		await renderPage({ agents: [] })

		expect(host.querySelector("[role=status]")?.textContent).toBe(t("conversations.noAgentSelected"))
		expect(requested.some((url) => url.startsWith("/api/conversations"))).toBe(false)
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
		expect(host.querySelector("[role=alert]")?.textContent).toBe(t("problems.internal-server-error"))

		await act(async () => button(t("common.retry")).click())
		await settle()

		expect(host.textContent).toContain("Question a")
	})
})
