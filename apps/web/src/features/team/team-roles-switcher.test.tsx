import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { TeamRolesSwitcher } = await import("./team-roles-switcher")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } = await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

let permissions: string[]
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

async function renderSwitcher() {
	const rootRoute = createRootRoute({ component: () => <TeamRolesSwitcher /> })
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
}

beforeEach(() => {
	permissions = []
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		if (url === "/api/me/permissions") return json({ permissions })
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

describe("TeamRolesSwitcher", () => {
	test("links role managers between the team and its roles", async () => {
		permissions = ["roles:manage"]
		await renderSwitcher()

		const nav = host.querySelector("nav")
		expect(nav?.getAttribute("aria-label")).toBe(t("team.switcherLabel"))
		expect([...host.querySelectorAll("nav a")].map((link) => link.textContent)).toEqual([
			t("team.heading"),
			t("roles.heading"),
		])
		expect([...host.querySelectorAll("nav a")].map((link) => link.getAttribute("href"))).toEqual([
			"/dashboard/team",
			"/dashboard/team/roles",
		])
	})

	test("stays hidden without role management access", async () => {
		permissions = ["users:read"]
		await renderSwitcher()

		expect(host.querySelector("nav") === null).toBe(true)
	})
})
