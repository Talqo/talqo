import type { QueryClient } from "@/testing/component-harness"

import { json } from "@/testing/api-responses"
import { act, createTestHarness, QueryClientProvider, type Root, settle } from "@/testing/component-harness"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { Route } = await import("./agents")
const { LanguageProvider } = await import("@/lib/use-language")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
	await import("@tanstack/react-router")
const { t } = await import("i18next")

const AgentsPage = Route.options.component
if (!AgentsPage) throw new Error("Agents route has no component")

let permissions: string[]
let createResponse: Response | undefined
let listRequests: number
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let harness: ReturnType<typeof createTestHarness>

function problem(code: string, status: number): Response {
	return json({ code, type: `https://docs.talqo.chat/problems#${code}` }, status)
}

async function renderPage() {
	const rootRoute = createRootRoute()
	const list = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard/agents", component: AgentsPage })
	const router = createRouter({
		routeTree: rootRoute.addChildren([list]),
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
	createResponse = undefined
	listRequests = 0
	harness = createTestHarness({
		fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
			if (url === "/api/me/permissions") return json({ permissions })
			if (url === "/api/agents") {
				if (init?.method === "POST") return createResponse ?? json({ agent: {} }, 201)
				listRequests += 1
				return json({ agents: [] })
			}
			throw new Error(`unexpected request ${url}`)
		}) as typeof fetch,
	})
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

describe("AgentsPage empty states", () => {
	test("invites an admin to create the first agent", async () => {
		await renderPage()

		expect(host.textContent).toContain(t("agents.emptyTitle"))
		expect(host.textContent).toContain(t("agents.emptyDescriptionManager"))
		expect(buttons(t("agents.create")).length).toBe(2)
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

describe("AgentsPage create failures", () => {
	test("does not offer a retry when creating is forbidden", async () => {
		createResponse = problem("permission-denied", 403)
		await renderPage()
		await click(buttons(t("agents.create"))[0])

		expect(host.querySelector("[role=alert] p")?.textContent).toBe(t("agents.manageForbidden"))
		expect(buttons(t("common.retry"))).toHaveLength(0)
	})

	test("reloads the names and keeps a retry after a name conflict", async () => {
		createResponse = problem("agent-name-taken", 409)
		await renderPage()
		const before = listRequests
		await click(buttons(t("agents.create"))[0])

		expect(host.querySelector("[role=alert] p")?.textContent).toBe(t("agents.nameConflict"))
		expect(buttons(t("common.retry"))).toHaveLength(1)
		expect(listRequests).toBe(before + 1)
	})
})
