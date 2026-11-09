import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { Route } = await import("./agents")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const AgentsPage = Route.options.component ?? (() => null)

let permissions: string[]
let permissionsResponse: Promise<Response> | undefined
let createResponse: Response | Promise<Response> | undefined
let createRequests: unknown[]
let listedAgentNames: string[]
let unreadableAgentNames: string[]
let listRequests: number
let listResponse: Response | undefined
let listRequestsAtNavigation: number | undefined
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function problem(code: string, status: number): Response {
	return json({ code, type: `https://docs.talqo.chat/problems#${code}` }, status)
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderPage() {
	const rootRoute = createRootRoute()
	const list = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard/agents", component: AgentsPage })
	const detail = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/agent/$agentId",
		beforeLoad: () => {
			listRequestsAtNavigation = listRequests
		},
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([list, detail]),
		history: createMemoryHistory({ initialEntries: ["/dashboard/agents"] }),
	})
	await act(async () => {
		await router.load()
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<RouterProvider router={router} />
				</LanguageProvider>
			</QueryClientProvider>,
		)
	})
	await settle()
	await settle()
	return router
}

async function click(button: HTMLButtonElement | undefined) {
	if (!button) throw new Error("button not rendered")
	await act(async () => button.click())
	await settle()
	await settle()
}

function buttons(label: string): HTMLButtonElement[] {
	return [...host.querySelectorAll("button")].filter((element) => element.textContent?.trim() === label)
}

beforeEach(() => {
	permissions = ["admin"]
	permissionsResponse = undefined
	createResponse = undefined
	createRequests = []
	listedAgentNames = []
	unreadableAgentNames = []
	listRequests = 0
	listResponse = undefined
	listRequestsAtNavigation = undefined
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		if (url === "/api/me/permissions") return permissionsResponse ?? json({ permissions })
		if (url === "/api/agents") {
			if (init?.method === "POST") {
				if (typeof init.body !== "string") throw new Error("create request must have a JSON body")
				createRequests.push(JSON.parse(init.body))
				return createResponse ?? json({ agent: { id: "created-agent" } }, 201)
			}
			listRequests += 1
			if (listResponse) return listResponse
			return json({
				agents: [
					...listedAgentNames.map((name, index) => ({
						id: `listed-agent-${index}`,
						name,
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
						permissions: ["agents:read"],
					})),
					...unreadableAgentNames.map((name, index) => ({
						id: `unreadable-agent-${index}`,
						name,
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
						permissions: [],
					})),
				],
			})
		}
		if (/^\/api\/agents\/[^/]+\/files$/.test(url)) return json({ files: [] })
		if (/^\/api\/agents\/[^/]+\/mcp-servers$/.test(url)) return json({ servers: [], stdioAllowed: false })
		if (url.startsWith("/api/embeds?")) return json({ embeds: [] })
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

test("guards the page with read access", () => {
	expect(Route.options.beforeLoad?.({} as never)).toEqual({ requires: "agents:read" })
})

describe("AgentsPage empty states", () => {
	test("invites an admin to create the first agent", async () => {
		await renderPage()

		expect(host.textContent).toContain(t("agents.emptyTitle"))
		expect(host.textContent).toContain(t("agents.emptyDescriptionManager"))
		expect(buttons(t("agents.create")).length).toBe(2)

		await click(buttons(t("agents.create"))[1])
		expect(createRequests).toHaveLength(1)
	})

	test("does not tell a reader to create an agent", async () => {
		permissions = ["users:read"]
		await renderPage()

		expect(host.textContent).toContain(t("agents.emptyTitle"))
		expect(host.textContent).toContain(t("agents.emptyDescriptionReader"))
		expect(host.textContent).not.toContain(t("agents.emptyDescriptionManager"))
		expect(buttons(t("agents.create"))).toHaveLength(0)
	})
})

describe("AgentsPage load failures", () => {
	test("shows the load failure and refetches on retry", async () => {
		listResponse = new Response(null, { status: 500 })
		await renderPage()

		expect(host.querySelector("[role=alert] p")?.textContent).toBe(t("agents.loadFailed"))
		const before = listRequests

		await click(buttons(t("common.retry"))[0])

		expect(listRequests).toBe(before + 1)
	})
})

describe("AgentsPage access filtering", () => {
	test("omits cards and links for agents without read access", async () => {
		listedAgentNames = ["Readable agent"]
		unreadableAgentNames = ["Unreadable agent"]
		await renderPage()

		expect(host.textContent).toContain("Readable agent")
		expect(host.textContent).not.toContain("Unreadable agent")
		expect(host.querySelector("a[aria-label='Readable agent']")?.getAttribute("href")).toBe(
			"/dashboard/agent/listed-agent-0",
		)
		expect(host.querySelector("a[aria-label='Unreadable agent']") === null).toBe(true)
	})
})

describe("AgentsPage permissions", () => {
	test("offers creation only after admin permissions resolve", async () => {
		const pending = Promise.withResolvers<Response>()
		permissionsResponse = pending.promise
		await renderPage()

		expect(buttons(t("agents.create"))).toHaveLength(0)

		await act(async () => pending.resolve(json({ permissions })))
		await settle()
		await settle()

		expect(buttons(t("agents.create")).length).toBeGreaterThan(0)
	})
})

describe("AgentsPage creation", () => {
	test("creates with the shared defaults, refreshes, and opens the new agent", async () => {
		const defaultName = t("agents.defaultName")
		listedAgentNames = [defaultName]
		createResponse = json({ agent: { id: "created-agent" } }, 201)
		const router = await renderPage()
		const before = listRequests

		await click(buttons(t("agents.create"))[0])

		expect(createRequests).toEqual([
			{
				name: `${defaultName} 2`,
				systemPrompt: t("agents.defaultSystemPrompt"),
				wordBlacklist: [],
			},
		])
		expect(listRequests).toBe(before + 1)
		expect(listRequestsAtNavigation).toBe(before + 1)
		expect(router.state.location.pathname).toBe("/dashboard/agent/created-agent")
	})
})

describe("AgentsPage create failures", () => {
	test("does not offer a retry when creating is forbidden", async () => {
		createResponse = problem("permission-denied", 403)
		await renderPage()
		await click(buttons(t("agents.create"))[0])

		expect(host.querySelector("[role=alert] p")?.textContent).toBe(t("agents.manageForbidden"))
		expect(buttons(t("common.retry"))).toHaveLength(0)
	})

	test("keeps a server failure retryable without refreshing names", async () => {
		createResponse = problem("internal-server-error", 500)
		await renderPage()
		const before = listRequests
		await click(buttons(t("agents.create"))[0])

		expect(host.querySelector("[role=alert] p")?.textContent).toBe(t("agents.createFailed"))
		expect(buttons(t("common.retry"))).toHaveLength(1)
		expect(listRequests).toBe(before)
	})

	test("reloads the names and retries with a free name after a name conflict", async () => {
		createResponse = problem("agent-name-taken", 409)
		const router = await renderPage()
		const before = listRequests
		const defaultName = t("agents.defaultName")
		listedAgentNames = [defaultName, `${defaultName} 2`]
		await click(buttons(t("agents.create"))[0])

		expect(host.querySelector("[role=alert] p")?.textContent).toBe(t("agents.nameConflict"))
		expect(buttons(t("common.retry"))).toHaveLength(1)
		expect(listRequests).toBe(before + 1)

		const retryResponse = Promise.withResolvers<Response>()
		createResponse = retryResponse.promise
		await click(buttons(t("common.retry"))[0])

		expect(host.querySelector("[role=alert] p") === null).toBe(true)
		expect(createRequests).toEqual([
			{
				name: defaultName,
				systemPrompt: t("agents.defaultSystemPrompt"),
				wordBlacklist: [],
			},
			{
				name: `${defaultName} 3`,
				systemPrompt: t("agents.defaultSystemPrompt"),
				wordBlacklist: [],
			},
		])

		await act(async () => {
			retryResponse.resolve(json({ agent: { id: "retried-agent" } }, 201))
			await retryResponse.promise
		})
		await settle()
		await settle()

		expect(listRequests).toBe(before + 2)
		expect(listRequestsAtNavigation).toBe(before + 2)
		expect(router.state.location.pathname).toBe("/dashboard/agent/retried-agent")
	})
})
