import { json } from "@/testing/api-responses"
import { act, createTestHarness, type QueryClient, type Root, settle } from "@/testing/component-harness"
import { renderRouter } from "@/testing/router"
import { afterEach, beforeEach, expect, test } from "bun:test"

const { Route } = await import("./index")
const { createMemoryHistory, createRootRoute, createRoute, createRouter } = await import("@tanstack/react-router")
const { t } = await import("i18next")

const DashboardPage = Route.options.component ?? (() => null)
const validateSearch = Route.options.validateSearch
if (typeof validateSearch !== "function") throw new Error("Dashboard route has no search validator")

let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let requests: { method: string; url: string }[]
let listedAgents: unknown[]

function emptyOverview(days: number) {
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

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
	const method = init?.method ?? "GET"
	requests.push({ method, url })
	if (url === "/api/me/permissions") return json({ permissions: ["admin"] })
	if (url === "/api/agents" && method === "POST") return json({ agent: { id: "created-agent" } }, 201)
	if (url === "/api/agents") return json({ agents: listedAgents })
	if (url.startsWith("/api/stats"))
		return json(emptyOverview(Number(new URL(url, "http://localhost").searchParams.get("days"))))
	throw new Error(`Unexpected request ${method} ${url}`)
}

async function renderPage(initialEntry: string) {
	const rootRoute = createRootRoute()
	const page = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/",
		validateSearch,
		component: DashboardPage,
	})
	const detail = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/agent/$agentId",
		component: () => null,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([page, detail]),
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
	})
	await renderRouter(root, queryClient, router)
	return router
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

async function choose(label: string, option: string) {
	await click(combobox(label))
	const item = [...document.querySelectorAll<HTMLElement>("[role=option]")].find(
		(element) => element.textContent?.trim() === option,
	)
	if (!item) throw new Error(`${option} option not rendered`)
	await click(item)
}

function button(label: string): HTMLButtonElement {
	const found = [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label)
	if (!found) throw new Error(`${label} button not rendered`)
	return found
}

beforeEach(() => {
	requests = []
	listedAgents = [
		{
			id: "agent-1",
			name: "Shop helper",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			permissions: ["stats:read"],
		},
	]
	harness = createTestHarness({ fetch: respond as typeof fetch })
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

test("parses shareable agent and range search params and guards on statistics access", () => {
	expect(validateSearch({ agents: '["agent-1","agent-2"]', days: "7" })).toEqual({
		agents: ["agent-1", "agent-2"],
		days: 7,
	})
	expect(validateSearch({})).toEqual({ agents: undefined, days: undefined })
	expect(validateSearch({ agents: 42, days: "90" })).toEqual({ agents: [], days: undefined })
	expect(Route.options.beforeLoad?.({} as never)).toEqual({ requires: "stats:read" })
})

test("updates the URL when the range changes", async () => {
	const router = await renderPage("/dashboard/?agents=agent-1&days=7")
	const historyLength = router.history.length

	await choose(t("dashboard.rangeLabel"), t("dashboard.range30d"))

	expect(router.state.location.search).toEqual({ agents: ["agent-1"], days: undefined })
	expect(router.history.length).toBe(historyLength)
})

test("opens a newly created agent", async () => {
	listedAgents = []
	const router = await renderPage("/dashboard/")

	await click(button(t("agents.create")))

	expect(requests).toContainEqual({ method: "POST", url: "/api/agents" })
	expect(router.state.location.pathname).toBe("/dashboard/agent/created-agent")
})
